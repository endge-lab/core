import type {
  QuerySourceDocument,
  QuerySourcePatch,
  QuerySourcePatchOperation,
} from '@/domain/types/query-source.types'
import type { SourcePatchResult } from '@/domain/types/source-engine.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import { compileQuerySource } from '@/model/services/source-engine/query-source-compile'

interface QueryDefinitionParseResult {
  ast: t.File | null
  definition: t.ObjectExpression | null
  message?: string
}

interface InsertTarget {
  object: t.ObjectExpression
  depth: number
}

/** Парсит query source в normalized document для editor projections. */
export function parseQuerySource(source: string) {
  const result = compileQuerySource(source)
  const ok = !result.diagnostics.some(diagnostic => diagnostic.severity === 'error')

  return {
    ok,
    ast: result.ast ?? undefined,
    document: result.document ?? undefined,
    diagnostics: result.diagnostics,
    message: ok ? undefined : 'Query source contains parsing errors.',
  }
}

/** Патчит query source v1 по editor-slot операции, не перепечатывая весь документ. */
export function patchQuerySource(source: string, patch: QuerySourcePatch): SourcePatchResult<QuerySourceDocument> {
  const operations = Array.isArray(patch) ? patch : [patch]
  let nextSource = source
  let changed = false

  for (const operation of operations) {
    const operationResult = applyPatchOperation(nextSource, operation)
    if (!operationResult.ok) {
      return {
        ok: false,
        source: nextSource,
        changed,
        message: operationResult.message,
        diagnostics: operationResult.diagnostics,
      }
    }

    changed = changed || operationResult.changed
    nextSource = operationResult.source
  }

  const parsed = parseQuerySource(nextSource)
  return {
    ...parsed,
    source: nextSource,
    changed,
  }
}

function applyPatchOperation(
  source: string,
  operation: QuerySourcePatchOperation,
): SourcePatchResult<QuerySourceDocument> {
  const parsed = parseDefinition(source)
  if (!parsed.definition) {
    return {
      ok: false,
      source,
      changed: false,
      ast: parsed.ast ?? undefined,
      message: parsed.message ?? 'Query source должен содержать defineQuery({...}).',
      diagnostics: [],
    }
  }

  const parts = operation.path.split('.')
  const expression = operation.expression ?? printValue(operation.value, pathDepth(operation.path))
  if (operation.expression && !isExpressionSyntaxValid(expression)) {
    return {
      ok: false,
      source,
      changed: false,
      ast: parsed.ast ?? undefined,
      message: `Invalid source expression for query path "${operation.path}".`,
      diagnostics: [],
    }
  }

  const existing = findProperty(parsed.definition, parts)

  if (existing && typeof existing.value.start === 'number' && typeof existing.value.end === 'number') {
    const nextSource = replaceRange(source, existing.value.start, existing.value.end, expression)
    return {
      ...parseQuerySource(nextSource),
      source: nextSource,
      changed: nextSource !== source,
    }
  }

  const parentPath = parts.slice(0, -1)
  const key = parts[parts.length - 1]
  const target = resolveInsertTarget(parsed.definition, parentPath, source)
  if (!target) {
    return {
      ok: false,
      source,
      changed: false,
      ast: parsed.ast ?? undefined,
      message: `Cannot patch query source path "${operation.path}". Parent object is missing.`,
      diagnostics: [],
    }
  }

  const nextSource = insertProperty(source, target, key, expression)
  return {
    ...parseQuerySource(nextSource),
    source: nextSource,
    changed: nextSource !== source,
  }
}

function parseDefinition(source: string): QueryDefinitionParseResult {
  try {
    const ast = parseTS(source, {
      sourceType: 'module',
      plugins: ['typescript'],
    })
    const defineCall = findDefineQueryCall(ast)
    const argument = defineCall?.arguments[0]
    const definition = argument && t.isExpression(argument)
      ? unwrapExpression(argument)
      : null

    return {
      ast,
      definition: t.isObjectExpression(definition) ? definition : null,
      message: definition ? undefined : 'defineQuery принимает только объектный литерал.',
    }
  }
  catch (error: any) {
    return {
      ast: null,
      definition: null,
      message: `Не удалось распарсить query source: ${error?.message ?? error}`,
    }
  }
}

function findDefineQueryCall(ast: t.File): t.CallExpression | null {
  for (const statement of ast.program.body) {
    if (!t.isExpressionStatement(statement))
      continue

    const expression = unwrapExpression(statement.expression)
    if (!t.isCallExpression(expression))
      continue

    if (t.isIdentifier(expression.callee, { name: 'defineQuery' }))
      return expression
  }

  return null
}

function findProperty(
  root: t.ObjectExpression,
  path: string[],
): { property: t.ObjectProperty, value: t.Expression } | null {
  let current: t.ObjectExpression = root

  for (const [index, key] of path.entries()) {
    const property = getObjectProperty(current, key)
    if (!property)
      return null

    const value = unwrapExpression(property.value as t.Expression)
    if (index === path.length - 1)
      return { property, value }

    if (!t.isObjectExpression(value))
      return null
    current = value
  }

  return null
}

function resolveInsertTarget(
  root: t.ObjectExpression,
  parentPath: string[],
  source: string,
): InsertTarget | null {
  if (!parentPath.length)
    return { object: root, depth: depthForObject(root, source) }

  const parent = findProperty(root, parentPath)
  if (!parent || !t.isObjectExpression(parent.value))
    return null

  return {
    object: parent.value,
    depth: depthForObject(parent.value, source),
  }
}

function insertProperty(source: string, target: InsertTarget, key: string, expression: string): string {
  const object = target.object
  if (typeof object.end !== 'number')
    return source

  const closeOffset = object.end - 1
  const hasProperties = object.properties.length > 0
  const childIndent = '  '.repeat(target.depth + 1)
  const ownIndent = '  '.repeat(target.depth)
  const propertyLine = `${childIndent}${printKey(key)}: ${indentExpression(expression, childIndent)},`

  if (!hasProperties)
    return replaceRange(source, closeOffset, closeOffset, `\n${propertyLine}\n${ownIndent}`)

  return replaceRange(source, closeOffset, closeOffset, `${propertyLine}\n${ownIndent}`)
}

function depthForObject(node: t.ObjectExpression, source: string): number {
  if (typeof node.start !== 'number')
    return 0

  const before = source.slice(0, node.start)
  const lastLineBreak = before.lastIndexOf('\n')
  const column = lastLineBreak >= 0
    ? before.length - lastLineBreak - 1
    : before.length

  return Math.max(0, Math.floor(column / 2))
}

function indentExpression(expression: string, childIndent: string): string {
  if (!expression.includes('\n'))
    return expression

  const continuationIndent = `${childIndent}  `
  return expression
    .split('\n')
    .map((line, index) => index === 0 ? line : `${continuationIndent}${line}`)
    .join('\n')
}

function replaceRange(source: string, start: number, end: number, value: string): string {
  return `${source.slice(0, start)}${value}${source.slice(end)}`
}

function getObjectProperty(node: t.ObjectExpression, key: string): t.ObjectProperty | null {
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed)
      continue

    if (getPropertyName(property.key) === key)
      return property
  }

  return null
}

function getPropertyName(key: t.ObjectProperty['key']): string | null {
  if (t.isIdentifier(key))
    return key.name
  if (t.isStringLiteral(key))
    return key.value
  if (t.isNumericLiteral(key))
    return String(key.value)
  return null
}

function unwrapExpression<T extends t.Expression>(node: T): t.Expression {
  let current: t.Expression = node
  while (
    t.isTSAsExpression(current)
    || t.isTSTypeAssertion(current)
    || t.isTSNonNullExpression(current)
    || t.isParenthesizedExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function pathDepth(path: string): number {
  const depthByRoot: Record<string, number> = {
    'request.headers': 2,
    'request.auth': 2,
    'mock.data': 2,
  }
  return depthByRoot[path] ?? 0
}

function isExpressionSyntaxValid(expression: string): boolean {
  try {
    parseTS(`const __endgeExpression = (${expression});`, {
      sourceType: 'module',
      plugins: ['typescript'],
    })
    return true
  }
  catch {
    return false
  }
}

function printValue(value: unknown, depth = 0): string {
  if (value === undefined)
    return 'undefined'
  if (value === null)
    return 'null'
  if (typeof value === 'string')
    return quote(value)
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  if (Array.isArray(value))
    return printArray(value, depth)
  if (typeof value === 'object')
    return printPlainObject(value as Record<string, unknown>, depth)

  return quote(String(value))
}

function printArray(value: unknown[], depth: number): string {
  if (!value.length)
    return '[]'

  const indent = '  '.repeat(depth)
  const childIndent = '  '.repeat(depth + 1)
  const lines = value.map(item => `${childIndent}${printValue(item, depth + 1)},`)
  return `[\n${lines.join('\n')}\n${indent}]`
}

function printPlainObject(value: Record<string, unknown>, depth: number): string {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined)
  if (!entries.length)
    return '{}'

  const indent = '  '.repeat(depth)
  const childIndent = '  '.repeat(depth + 1)
  const lines = entries.map(([key, item]) => `${childIndent}${printKey(key)}: ${printValue(item, depth + 1)},`)
  return `{\n${lines.join('\n')}\n${indent}}`
}

function printKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : quote(key)
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`
}
