import type {
  FilterProgramOutput,
  FilterSourceEditorDocument,
  FilterSourceEditorField,
  FilterSourceEditorOutput,
  FilterSourcePatch,
  FilterSourcePatchOperation,
} from '@/features/core/modules/source/domain/types/filter-source.types'
import type { SourcePatchResult } from '@/features/core/modules/source/domain/types/source-engine.types'
import type { SourceFieldDefinition } from '@/features/core/modules/source/domain/types/source-expression.types'

import { parseExpression, parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import { compileFilterSource } from '@/features/core/modules/source/services/compilers/filter-source-compile'
import { propertyName, unwrapExpression } from '@/features/core/modules/source/services/compilers/source-expression-compile'

interface FilterDefinitionContext {
  ast: t.File
  definition: t.ObjectExpression
  fields: t.ObjectExpression
  outputs: t.ObjectExpression
}

interface ParsedFilterSource {
  context: FilterDefinitionContext | null
  result: ReturnType<typeof compileFilterSource>
  message?: string
}

/** Парсит Filter source в проекцию с абсолютными source ranges. */
export function parseFilterSourceForEditor(source: string) {
  const parsed = parseFilterDefinition(source)
  const diagnostics = parsed.result.diagnostics
  const hasErrors = diagnostics.some(item => item.severity === 'error')
  const document = parsed.context && parsed.result.artifact
    ? projectEditorDocument(source, parsed.context, parsed.result.artifact.fields, parsed.result.artifact.outputs)
    : undefined

  return {
    ok: !hasErrors && Boolean(document),
    ast: parsed.result.ast ?? undefined,
    document,
    diagnostics,
    message: parsed.message ?? (hasErrors ? 'Filter source contains parsing errors.' : undefined),
  }
}

/** Применяет visual-editor patch, не создавая вторую persisted-модель Filter. */
export function patchFilterSource(
  source: string,
  patch: FilterSourcePatch,
): SourcePatchResult<FilterSourceEditorDocument> {
  const operations = Array.isArray(patch) ? patch : [patch]
  let nextSource = source
  let changed = false

  for (const operation of operations) {
    const result = applyFilterPatch(nextSource, operation)
    if (!result.ok) {
      return {
        ...result,
        changed,
      }
    }
    nextSource = result.source
    changed = changed || result.changed
  }

  const parsed = parseFilterSourceForEditor(nextSource)
  return {
    ...parsed,
    source: nextSource,
    changed,
  }
}

function applyFilterPatch(
  source: string,
  operation: FilterSourcePatchOperation,
): SourcePatchResult<FilterSourceEditorDocument> {
  const parsed = parseFilterDefinition(source)
  const context = parsed.context
  if (!context) {
    return {
      ok: false,
      source,
      changed: false,
      diagnostics: parsed.result.diagnostics,
      message: parsed.message ?? 'Filter source должен содержать defineFilter с fields и outputs.',
    }
  }

  try {
    let nextSource = source
    if (operation.type === 'add-field') {
      validateFieldKey(operation.key)
      validateFieldExpression(operation.key, operation.expression)
      if (findFieldProperty(context.fields, operation.key)) {
        throw new Error(`Field "${operation.key}" уже существует.`)
      }
      nextSource = insertField(source, context.fields, operation.key, operation.expression)
    }
    else if (operation.type === 'remove-field') {
      const property = requireFieldProperty(context.fields, operation.key)
      nextSource = removeObjectProperty(source, context.fields, property)
    }
    else if (operation.type === 'move-field') {
      nextSource = moveField(source, context.fields, operation.key, operation.toIndex)
    }
    else if (operation.type === 'rename-field') {
      validateFieldKey(operation.nextKey)
      if (operation.key !== operation.nextKey && findFieldProperty(context.fields, operation.nextKey)) {
        throw new Error(`Field "${operation.nextKey}" уже существует.`)
      }
      nextSource = renameField(source, context, operation.key, operation.nextKey)
    }
    else {
      validateFieldExpression(operation.key, operation.expression)
      const property = requireFieldProperty(context.fields, operation.key)
      nextSource = replaceNode(source, property.value, operation.expression)
    }

    const next = parseFilterSourceForEditor(nextSource)
    return {
      ...next,
      source: nextSource,
      changed: nextSource !== source,
    }
  }
  catch (error) {
    return {
      ok: false,
      source,
      changed: false,
      diagnostics: parsed.result.diagnostics,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

function parseFilterDefinition(source: string): ParsedFilterSource {
  const result = compileFilterSource(source)
  try {
    const ast = parseTS(source, { sourceType: 'module', plugins: ['typescript'] })
    const call = findDefineFilter(ast)
    const definition = call?.arguments[0]
    if (!call || !definition || !t.isObjectExpression(definition)) {
      return {
        context: null,
        result,
        message: 'Filter source должен содержать defineFilter({...}).',
      }
    }

    const fields = objectProperty(definition, 'fields')
    const outputs = objectProperty(definition, 'outputs')
    if (!fields || !outputs) {
      return {
        context: null,
        result,
        message: 'Visual Filter требует object-literal sections fields и outputs.',
      }
    }

    return {
      context: { ast, definition, fields, outputs },
      result,
    }
  }
  catch (error) {
    return {
      context: null,
      result,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

function projectEditorDocument(
  source: string,
  context: FilterDefinitionContext,
  compiledFields: SourceFieldDefinition[],
  compiledOutputs: FilterProgramOutput[],
): FilterSourceEditorDocument {
  const fieldsByKey = new Map(compiledFields.map(field => [field.key, field]))
  const outputsByKey = new Map(compiledOutputs.map(output => [output.key, output]))
  const fields: FilterSourceEditorField[] = []
  const outputs: FilterSourceEditorOutput[] = []

  for (const property of context.fields.properties) {
    if (!isEditableProperty(property)) {
      continue
    }
    const key = propertyName(property.key)
    const field = key ? fieldsByKey.get(key) : null
    if (!key || !field) {
      continue
    }
    fields.push({
      ...field,
      sourceRange: range(property),
      keyRange: range(property.key),
      valueRange: range(property.value),
      valueSource: sliceNode(source, property.value),
      defaultSource: modifierArgumentSource(source, property.value, 'default'),
    })
  }

  for (const property of context.outputs.properties) {
    if (!isEditableProperty(property)) {
      continue
    }
    const key = propertyName(property.key)
    const output = key ? outputsByKey.get(key) : null
    if (!key || !output) {
      continue
    }
    outputs.push({
      key,
      kind: output.kind,
      sourceRange: range(property),
      source: sliceNode(source, property.value),
    })
  }

  return { fields, outputs }
}

function findDefineFilter(ast: t.File): t.CallExpression | null {
  for (const statement of ast.program.body) {
    if (!t.isExpressionStatement(statement)) {
      continue
    }
    const expression = unwrapExpression(statement.expression)
    if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'defineFilter' })) {
      return expression
    }
  }
  return null
}

function objectProperty(node: t.ObjectExpression, name: string): t.ObjectExpression | null {
  for (const property of node.properties) {
    if (
      t.isObjectProperty(property)
      && !property.computed
      && propertyName(property.key) === name
      && t.isObjectExpression(property.value)
    ) {
      return property.value
    }
  }
  return null
}

function isEditableProperty(
  property: t.ObjectExpression['properties'][number],
): property is t.ObjectProperty & { key: t.Expression, value: t.Expression } {
  return t.isObjectProperty(property)
    && !property.computed
    && t.isExpression(property.key)
    && t.isExpression(property.value)
}

function findFieldProperty(
  fields: t.ObjectExpression,
  key: string,
): (t.ObjectProperty & { key: t.Expression, value: t.Expression }) | null {
  for (const property of fields.properties) {
    if (isEditableProperty(property) && propertyName(property.key) === key) {
      return property
    }
  }
  return null
}

function requireFieldProperty(
  fields: t.ObjectExpression,
  key: string,
): t.ObjectProperty & { key: t.Expression, value: t.Expression } {
  const property = findFieldProperty(fields, key)
  if (!property) {
    throw new Error(`Field "${key}" не найден в source.`)
  }
  return property
}

function insertField(
  source: string,
  fields: t.ObjectExpression,
  key: string,
  expression: string,
): string {
  const closeOffset = requireOffset(fields.end) - 1
  const ownIndent = lineIndent(source, requireOffset(fields.start))
  const childIndent = `${ownIndent}  `
  const entry = `${childIndent}${printKey(key)}: ${expression},`
  const closingLineStart = source.lastIndexOf('\n', closeOffset - 1) + 1
  const hasOwnClosingLine = source.slice(closingLineStart, closeOffset).trim() === ''
  if (hasOwnClosingLine) {
    return replaceRange(source, closingLineStart, closeOffset, `${entry}\n${ownIndent}`)
  }
  return replaceRange(source, closeOffset, closeOffset, `\n${entry}\n${ownIndent}`)
}

function removeObjectProperty(
  source: string,
  object: t.ObjectExpression,
  property: t.ObjectProperty,
): string {
  const properties = object.properties.filter(isEditableProperty)
  const index = properties.indexOf(property as typeof properties[number])
  const start = requireOffset(property.start)
  const end = requireOffset(property.end)
  const next = properties[index + 1]
  const previous = properties[index - 1]

  if (next) {
    return replaceRange(source, start, requireOffset(next.start), '')
  }
  if (previous) {
    return replaceRange(source, requireOffset(previous.end), end, '')
  }

  const comma = source.slice(end, requireOffset(object.end) - 1).indexOf(',')
  return comma >= 0
    ? replaceRange(source, start, end + comma + 1, '')
    : replaceRange(source, start, end, '')
}

function moveField(
  source: string,
  fields: t.ObjectExpression,
  key: string,
  rawToIndex: number,
): string {
  const properties = fields.properties.filter(isEditableProperty)
  const fromIndex = properties.findIndex(property => propertyName(property.key) === key)
  if (fromIndex < 0) {
    throw new Error(`Field "${key}" не найден в source.`)
  }
  const toIndex = Math.max(0, Math.min(properties.length - 1, rawToIndex))
  if (fromIndex === toIndex) {
    return source
  }

  const ordered = [...properties]
  const [property] = ordered.splice(fromIndex, 1)
  if (!property) {
    return source
  }
  ordered.splice(toIndex, 0, property)

  const fragments = ordered.map(item => sliceNode(source, item))
  return properties
    .map((target, index) => ({
      start: requireOffset(target.start),
      end: requireOffset(target.end),
      value: fragments[index] ?? sliceNode(source, target),
    }))
    .sort((left, right) => right.start - left.start)
    .reduce(
      (nextSource, replacement) => replaceRange(
        nextSource,
        replacement.start,
        replacement.end,
        replacement.value,
      ),
      source,
    )
}

function renameField(
  source: string,
  context: FilterDefinitionContext,
  key: string,
  nextKey: string,
): string {
  if (key === nextKey) {
    return source
  }
  const property = requireFieldProperty(context.fields, key)
  const replacements: Array<{ start: number, end: number, value: string }> = [{
    start: requireOffset(property.key.start),
    end: requireOffset(property.key.end),
    value: printKey(nextKey),
  }]

  visitNodes(context.outputs, (node) => {
    if (
      t.isCallExpression(node)
      && t.isIdentifier(node.callee, { name: 'value' })
      && node.arguments.length > 0
      && t.isStringLiteral(node.arguments[0], { value: key })
    ) {
      replacements.push({
        start: requireOffset(node.arguments[0].start),
        end: requireOffset(node.arguments[0].end),
        value: JSON.stringify(nextKey),
      })
    }
  })

  return replacements
    .sort((left, right) => right.start - left.start)
    .reduce(
      (nextSource, replacement) => replaceRange(
        nextSource,
        replacement.start,
        replacement.end,
        replacement.value,
      ),
      source,
    )
}

function modifierArgumentSource(
  source: string,
  raw: t.Expression,
  modifierName: string,
): string | null {
  let current = unwrapExpression(raw)
  while (t.isCallExpression(current) && t.isMemberExpression(current.callee)) {
    const name = propertyName(current.callee.property)
    if (name === modifierName) {
      const argument = current.arguments[0]
      return argument && t.isExpression(argument) ? sliceNode(source, argument) : null
    }
    if (!t.isExpression(current.callee.object)) {
      break
    }
    current = unwrapExpression(current.callee.object)
  }
  return null
}

function validateFieldKey(key: string): void {
  if (!String(key ?? '').trim()) {
    throw new Error('Field key не может быть пустым.')
  }
}

function validateFieldExpression(key: string, expression: string): void {
  try {
    parseExpression(expression, { plugins: ['typescript'] })
  }
  catch (error) {
    throw new Error(`Некорректный source поля "${key}": ${error instanceof Error ? error.message : String(error)}`)
  }

  const source = `defineFilter({
  fields: {
    ${printKey(key)}: ${expression},
  },
  outputs: {},
})`
  const result = compileFilterSource(source)
  const error = result.diagnostics.find(item => item.severity === 'error')
  if (error) {
    throw new Error(error.message)
  }
}

function visitNodes(node: t.Node, visitor: (node: t.Node) => void): void {
  visitor(node)
  const keys = t.VISITOR_KEYS[node.type] ?? []
  for (const key of keys) {
    const value = (node as unknown as Record<string, unknown>)[key]
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === 'object' && 'type' in child) {
          visitNodes(child as t.Node, visitor)
        }
      }
    }
    else if (value && typeof value === 'object' && 'type' in value) {
      visitNodes(value as t.Node, visitor)
    }
  }
}

function printKey(key: string): string {
  return /^[A-Z_$][\w$]*$/i.test(key) ? key : JSON.stringify(key)
}

function range(node: t.Node): { start: number, end: number } {
  return {
    start: requireOffset(node.start),
    end: requireOffset(node.end),
  }
}

function sliceNode(source: string, node: t.Node): string {
  return source.slice(requireOffset(node.start), requireOffset(node.end))
}

function replaceNode(source: string, node: t.Node, value: string): string {
  return replaceRange(source, requireOffset(node.start), requireOffset(node.end), value)
}

function replaceRange(source: string, start: number, end: number, value: string): string {
  return `${source.slice(0, start)}${value}${source.slice(end)}`
}

function requireOffset(value: number | null | undefined): number {
  if (typeof value !== 'number') {
    throw new TypeError('Filter AST не содержит source range.')
  }
  return value
}

function lineIndent(source: string, offset: number): string {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1
  return source.slice(lineStart, offset).match(/^\s*/)?.[0] ?? ''
}
