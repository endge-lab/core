import type {
  CompositionSourceDocument,
  CompositionSourcePatch,
  CompositionSourcePatchOperation,
} from '@/domain/types/source/composition-source.types'
import type { SourceParseResult, SourcePatchResult } from '@/domain/types/source/source-engine.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import { compileCompositionSource } from '@/model/services/source-engine/compilers/composition-source-compile'

interface CompositionDefinitionParseResult {
  definition: t.ObjectExpression | null
  message?: string
}

interface PatchOperationResult {
  ok: boolean
  source: string
  message?: string
}

type CompositionDependencySection = 'data' | 'resources' | 'runtimes'

const ROOT_SECTION_ORDER = [
  'metadata',
  'activateOn',
  'props',
  'previewProps',
  'data',
  'resources',
  'runtimes',
  'hooks',
  'outputs',
] as const

/** Парсит Composition source в normalized editor document. */
export function parseCompositionSource(source: string): SourceParseResult<CompositionSourceDocument> {
  const result = compileCompositionSource(source)
  const ok = !result.diagnostics.some(diagnostic => diagnostic.severity === 'error')

  return {
    ok,
    ast: result.ast ?? undefined,
    document: result.document ?? undefined,
    diagnostics: result.diagnostics,
    message: ok ? undefined : 'Composition source contains parsing errors.',
  }
}

/** Атомарно добавляет dependencies, сохраняя нетронутые участки Composition source. */
export function patchCompositionSource(
  source: string,
  patch: CompositionSourcePatch,
): SourcePatchResult<CompositionSourceDocument> {
  const operations = Array.isArray(patch) ? patch : [patch]
  let nextSource = source

  for (const operation of operations) {
    const result = applyPatchOperation(nextSource, operation)
    if (!result.ok) {
      return {
        ok: false,
        source,
        changed: false,
        message: result.message,
        diagnostics: parseCompositionSource(source).diagnostics,
      }
    }
    nextSource = result.source
  }

  const parsed = parseCompositionSource(nextSource)
  return {
    ...parsed,
    source: nextSource,
    changed: nextSource !== source,
  }
}

function applyPatchOperation(
  source: string,
  operation: CompositionSourcePatchOperation,
): PatchOperationResult {
  const parsed = parseDefinition(source)
  if (!parsed.definition) {
    return {
      ok: false,
      source,
      message: parsed.message ?? 'Composition source должен содержать defineComposition({...}).',
    }
  }

  const name = String(operation.name ?? '').trim()
  const identity = String(operation.identity ?? '').trim()
  if (!name || !identity) {
    return {
      ok: false,
      source,
      message: 'Composition dependency требует непустые name и identity.',
    }
  }

  const section = getOperationSection(operation)
  const expression = printOperationExpression(operation)
  const sectionProperty = getObjectProperty(parsed.definition, section)

  if (!sectionProperty) {
    const nextSource = insertRootSection(source, parsed.definition, section, name, expression)
    return { ok: true, source: nextSource }
  }

  const sectionValue = unwrapExpression(sectionProperty.value as t.Expression)
  if (!t.isObjectExpression(sectionValue)) {
    return {
      ok: false,
      source,
      message: `Composition "${section}" должен быть object literal.`,
    }
  }

  if (getObjectProperty(sectionValue, name)) {
    return {
      ok: false,
      source,
      message: `Composition "${section}" уже содержит поле "${name}".`,
    }
  }

  const nextSource = insertObjectProperty(source, sectionValue, name, expression)
  return { ok: true, source: nextSource }
}

function parseDefinition(source: string): CompositionDefinitionParseResult {
  try {
    const ast = parseTS(source, {
      sourceType: 'module',
      plugins: ['typescript'],
    })
    const call = findDefineCompositionCall(ast)
    const argument = call?.arguments[0]
    const definition = argument && t.isExpression(argument)
      ? unwrapExpression(argument)
      : null

    return {
      definition: t.isObjectExpression(definition) ? definition : null,
      message: definition ? undefined : 'defineComposition принимает только объектный литерал.',
    }
  }
  catch (error: any) {
    return {
      definition: null,
      message: `Не удалось распарсить Composition source: ${error?.message ?? error}`,
    }
  }
}

function findDefineCompositionCall(ast: t.File): t.CallExpression | null {
  for (const statement of ast.program.body) {
    if (!t.isExpressionStatement(statement))
      continue

    const expression = unwrapExpression(statement.expression)
    if (
      t.isCallExpression(expression)
      && t.isIdentifier(expression.callee, { name: 'defineComposition' })
    ) {
      return expression
    }
  }

  return null
}

function getOperationSection(operation: CompositionSourcePatchOperation): CompositionDependencySection {
  if (operation.type === 'add-data')
    return 'data'
  if (operation.type === 'add-resource')
    return 'resources'
  return 'runtimes'
}

function printOperationExpression(operation: CompositionSourcePatchOperation): string {
  const base = `${operation.kind}(${quote(operation.identity)})`
  if (operation.type !== 'add-runtime')
    return base

  const activation = operation.activation ?? 'manual'
  return `${base}.activateOn(${activation}())`
}

function insertRootSection(
  source: string,
  root: t.ObjectExpression,
  section: CompositionDependencySection,
  name: string,
  expression: string,
): string {
  const rootIndent = getObjectChildIndent(root, source)
  const entryIndent = `${rootIndent}  `
  const block = [
    `${rootIndent}${section}: {`,
    `${entryIndent}${printKey(name)}: ${expression},`,
    `${rootIndent}},`,
  ].join('\n')
  const anchor = findRootSectionAnchor(root, section)

  if (anchor != null) {
    const insertionOffset = getLineStart(source, anchor)
    return replaceRange(source, insertionOffset, insertionOffset, `${block}\n\n`)
  }

  return insertBeforeObjectClose(source, root, block)
}

function findRootSectionAnchor(
  root: t.ObjectExpression,
  section: CompositionDependencySection,
): number | null {
  const sectionOrder = ROOT_SECTION_ORDER.indexOf(section)

  for (const property of root.properties) {
    if (!t.isObjectProperty(property) || property.computed)
      continue

    const name = getPropertyName(property.key)
    const propertyOrder = name == null
      ? -1
      : ROOT_SECTION_ORDER.indexOf(name as typeof ROOT_SECTION_ORDER[number])
    if (propertyOrder <= sectionOrder)
      continue

    const leadingCommentStart = property.leadingComments?.[0]?.start
    return typeof leadingCommentStart === 'number'
      ? leadingCommentStart
      : property.start ?? null
  }

  return null
}

function insertObjectProperty(
  source: string,
  object: t.ObjectExpression,
  name: string,
  expression: string,
): string {
  const childIndent = getObjectChildIndent(object, source)
  const propertyLine = `${childIndent}${printKey(name)}: ${expression},`
  return insertBeforeObjectClose(source, object, propertyLine)
}

function insertBeforeObjectClose(
  source: string,
  object: t.ObjectExpression,
  block: string,
): string {
  if (typeof object.end !== 'number')
    return source

  let nextSource = source
  let closeOffset = object.end - 1
  const lastProperty = object.properties.at(-1)
  if (lastProperty && typeof lastProperty.end === 'number') {
    const afterProperty = nextSource.slice(lastProperty.end, closeOffset)
    if (!afterProperty.trimStart().startsWith(',')) {
      nextSource = replaceRange(nextSource, lastProperty.end, lastProperty.end, ',')
      closeOffset += 1
    }
  }

  const closeLineStart = getLineStart(nextSource, closeOffset)
  const closeLinePrefix = nextSource.slice(closeLineStart, closeOffset)
  if (/^[\t ]*$/.test(closeLinePrefix)) {
    return replaceRange(
      nextSource,
      closeLineStart,
      closeLineStart,
      `${block}\n`,
    )
  }

  const closeIndent = getLineIndent(nextSource, object.start ?? closeOffset)
  return replaceRange(
    nextSource,
    closeOffset,
    closeOffset,
    `\n${block}\n${closeIndent}`,
  )
}

function getObjectChildIndent(object: t.ObjectExpression, source: string): string {
  const firstProperty = object.properties.find(property => typeof property.start === 'number')
  if (firstProperty?.start != null)
    return getLineIndent(source, firstProperty.start)

  return `${getLineIndent(source, object.start ?? 0)}  `
}

function getLineStart(source: string, offset: number): number {
  return source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
}

function getLineIndent(source: string, offset: number): string {
  const lineStart = getLineStart(source, offset)
  return source.slice(lineStart, offset).match(/^[\t ]*/)?.[0] ?? ''
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

function printKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : quote(key)
}

function quote(value: string): string {
  return `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\\\'')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}'`
}
