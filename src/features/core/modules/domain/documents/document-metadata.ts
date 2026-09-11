import type { Node } from '@babel/types'
import type {
  DocumentMetadataDiagnostic,
  DocumentMetadataInput,
  DocumentMetadataPatchResult,
  DocumentMetadataProjection,
} from '@/features/core/modules/domain/types/document/document-metadata.types'
import type { DomainDocumentType } from '@/features/core/modules/domain/types/document/document.types'
import type { ProgramMetadataMap } from '@/features/core/modules/program/domain/types/program-metadata.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import { compileComponentSFC } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-compile'
import { getDomainDocumentDescriptor } from '@/features/core/modules/domain/documents/domain-document-descriptors'
import { compileProgramMetadataExpression } from '@/features/core/modules/source/services/compilers/source-metadata-compile'

const DEFINITION_CALL_BY_TYPE: Partial<Record<DomainDocumentType, string>> = {
  'action': 'defineAction',
  'computation': 'defineComputation',
  'store': 'defineStore',
  'stream': 'defineStream',
  'simulation': 'defineSimulation',
  'update': 'defineUpdate',
  'query-custom': 'defineQuery',
  'query-gql': 'defineQuery',
  'query-rest': 'defineQuery',
  'data-view': 'defineDataView',
  'default-filter': 'defineFilter',
  'composition': 'defineComposition',
  'project': 'defineComposition',
  'vocabs': 'defineVocab',
  'type': 'defineType',
  'configuration': 'defineConfig',
}

/** Читает пользовательские metadata документа через объявленный descriptor backing. */
export function inspectDocumentMetadata(
  type: DomainDocumentType,
  input: DocumentMetadataInput,
): DocumentMetadataProjection {
  const backing = getDomainDocumentDescriptor(type).capabilities.metadata
  if (!backing) {
    return projection(null, 'missing', false, {}, [], null, 'Этот тип документа не поддерживает пользовательские metadata.')
  }
  if (backing === 'entity-meta') {
    return inspectEntityMetadata(input.meta)
  }
  if (type === 'component-sfc') {
    return inspectComponentMetadata(String(input.source ?? ''))
  }
  return inspectDefinitionMetadata(type, String(input.source ?? ''), backing === 'definition-property')
}

/** Патчит только metadata backing документа, не переписывая остальной Source или системные meta siblings. */
export function patchDocumentMetadata(
  type: DomainDocumentType,
  input: DocumentMetadataInput,
  metadata: ProgramMetadataMap,
): DocumentMetadataPatchResult {
  const source = String(input.source ?? '')
  const meta = cloneRecord(input.meta)
  const requestedError = validateMetadataValue(metadata)
  if (requestedError) {
    const current = inspectDocumentMetadata(type, input)
    const diagnostic = error('program-metadata-value', requestedError, 'metadata')
    return failure(source, meta, current, [...current.diagnostics, diagnostic], requestedError)
  }

  const current = inspectDocumentMetadata(type, input)
  if (!current.editable || !current.backing) {
    return failure(source, meta, current, current.diagnostics, current.message)
  }

  if (current.backing === 'entity-meta') {
    const nextMeta = cloneRecord(meta)
    if (Object.keys(metadata).length) {
      nextMeta.user = cloneJSON(metadata)
    }
    else {
      delete nextMeta.user
    }
    const next = inspectDocumentMetadata(type, { source, meta: nextMeta })
    return success(source, meta, source, nextMeta, next)
  }

  const nextSource = type === 'component-sfc'
    ? patchComponentMetadata(source, metadata)
    : patchDefinitionMetadata(type, source, current.backing === 'definition-property', metadata)
  if (nextSource == null) {
    return failure(source, meta, current, current.diagnostics, 'Не удалось безопасно определить диапазон metadata в Source.')
  }
  const next = inspectDocumentMetadata(type, { source: nextSource, meta })
  if (!next.editable || next.mode !== 'static' || serialize(next.metadata) !== serialize(metadata)) {
    return failure(source, meta, current, next.diagnostics, 'Не удалось безопасно обновить metadata в Source.')
  }
  return success(source, meta, nextSource, meta, next)
}

function inspectEntityMetadata(meta: Record<string, unknown> | null | undefined): DocumentMetadataProjection {
  const value = isRecord(meta) ? meta.user : undefined
  if (value === undefined) {
    return projection('entity-meta', 'missing', true, {}, [], null)
  }
  const message = validateMetadataValue(value)
  if (message) {
    const diagnostics = [error('entity-user-metadata-invalid', message, 'meta.user')]
    return projection('entity-meta', 'invalid', false, {}, diagnostics, null, message)
  }
  return projection('entity-meta', 'static', true, cloneJSON(value as ProgramMetadataMap), [], null)
}

function inspectComponentMetadata(source: string): DocumentMetadataProjection {
  const compiled = compileComponentSFC(source)
  const declarations = compiled.ast?.script?.metadata ?? []
  if (declarations.length > 1) {
    const diagnostics = [error('program-metadata-duplicate', 'Найдено несколько defineMetadata.', 'script.defineMetadata', declarations[1]?.range)]
    return projection('definition-declaration', 'duplicate', false, {}, diagnostics, declarations[0]?.range ?? null, 'Удалите дубликаты defineMetadata во вкладке Source.')
  }
  const declaration = declarations[0]
  if (!declaration) {
    return projection('definition-declaration', 'missing', true, {}, [], null)
  }
  const diagnostics = compiled.diagnostics.filter(item => item.severity === 'error' && (
    item.sourcePath?.startsWith('script.defineMetadata')
    || item.code.startsWith('program-metadata')
    || item.code.startsWith('sfc-metadata')
  )) as DocumentMetadataDiagnostic[]
  if (diagnostics.length) {
    return projection('definition-declaration', 'invalid', false, {}, diagnostics, declaration.range, 'defineMetadata не является статическим JSON-compatible object.')
  }
  return projection('definition-declaration', 'static', true, compiled.metadata.self, [], declaration.range)
}

function inspectDefinitionMetadata(type: DomainDocumentType, source: string, propertyBacking: boolean): DocumentMetadataProjection {
  const parsed = parseDefinition(type, source)
  if (!parsed.ok) {
    return projection(propertyBacking ? 'definition-property' : 'definition-declaration', 'invalid', false, {}, parsed.diagnostics, null, parsed.diagnostics[0]?.message)
  }
  const backing = propertyBacking ? 'definition-property' : 'definition-declaration'
  const nodes = propertyBacking ? metadataProperties(parsed.definition!) : parsed.metadataCalls
  if (nodes.length > 1) {
    const diagnostics = [error('program-metadata-duplicate', propertyBacking ? 'metadata объявлена повторно.' : 'Найдено несколько defineMetadata.', 'metadata', nodes[1])]
    return projection(backing, 'duplicate', false, {}, diagnostics, range(nodes[0]), 'Удалите дубликат metadata во вкладке Source.')
  }
  const node = nodes[0]
  if (!node) {
    return projection(backing, 'missing', true, {}, [], null)
  }
  const expression = propertyBacking
    ? t.isObjectProperty(node) && !node.computed && !node.shorthand && t.isExpression(node.value) ? unwrap(node.value) : null
    : t.isCallExpression(node) && node.arguments.length === 1 && node.arguments[0] && t.isExpression(node.arguments[0]) ? unwrap(node.arguments[0]) : null
  const diagnostics: DocumentMetadataDiagnostic[] = []
  const metadata = expression ? compileProgramMetadataExpression(expression, diagnostics, 'metadata') : {}
  if (!expression || diagnostics.some(item => item.severity === 'error')) {
    if (!expression) {
      diagnostics.push(error('program-metadata-shape', 'metadata должна быть статическим object literal.', 'metadata', node))
    }
    return projection(backing, 'invalid', false, {}, diagnostics, range(node), 'Metadata не является статическим JSON-compatible object.')
  }
  return projection(backing, 'static', true, metadata, diagnostics, range(node))
}

function patchComponentMetadata(source: string, metadata: ProgramMetadataMap): string | null {
  const compiled = compileComponentSFC(source)
  const macro = `defineMetadata(${serialize(metadata)})`
  const declaration = compiled.ast?.script?.metadata[0]
  if (declaration) {
    return replace(source, declaration.range.start, declaration.range.end, macro)
  }
  if (compiled.ast?.script) {
    return replace(source, compiled.ast.script.range.start, compiled.ast.script.range.start, `${macro}\n\n`)
  }
  return `<script setup lang="ts">\n${macro}\n</script>\n\n${source}`
}

function patchDefinitionMetadata(type: DomainDocumentType, source: string, propertyBacking: boolean, metadata: ProgramMetadataMap): string | null {
  const parsed = parseDefinition(type, source)
  if (!parsed.ok) {
    return null
  }
  if (!propertyBacking) {
    const macro = `defineMetadata(${serialize(metadata)})`
    const declaration = parsed.metadataCalls[0]
    if (declaration) {
      return replace(source, declaration.start!, declaration.end!, macro)
    }
    return replace(source, parsed.mainStatement!.start!, parsed.mainStatement!.start!, `${macro}\n\n`)
  }
  const definition = parsed.definition!
  const properties = metadataProperties(definition)
  const existing = properties[0]
  if (existing && t.isObjectProperty(existing) && t.isExpression(existing.value)) {
    return replace(source, existing.value.start!, existing.value.end!, indentJSON(metadata, lineIndent(source, existing.start!)))
  }
  const close = definition.end! - 1
  const indent = definition.properties[0] ? lineIndent(source, definition.properties[0].start!) : `${lineIndent(source, definition.start!)}  `
  const beforeClose = source.slice(definition.start!, close)
  const needsComma = definition.properties.length > 0 && !/,\s*$/.test(beforeClose)
  const prefix = definition.properties.length ? `${needsComma ? ',' : ''}\n` : '\n'
  return replace(source, close, close, `${prefix}${indent}metadata: ${indentJSON(metadata, indent)},\n${lineIndent(source, definition.start!)}`)
}

type ParsedDefinition = {
  ok: true
  definition: t.ObjectExpression | null
  mainStatement: t.ExpressionStatement | null
  metadataCalls: t.CallExpression[]
  diagnostics: DocumentMetadataDiagnostic[]
} | { ok: false, diagnostics: DocumentMetadataDiagnostic[] }

function parseDefinition(type: DomainDocumentType, source: string): ParsedDefinition {
  try {
    const file = parseTS(source, { sourceType: 'module', plugins: ['typescript'] })
    const callName = DEFINITION_CALL_BY_TYPE[type]
    const mainStatements: t.ExpressionStatement[] = []
    const metadataCalls: t.CallExpression[] = []
    for (const statement of file.program.body) {
      if (!t.isExpressionStatement(statement)) {
        continue
      }
      const value = unwrap(statement.expression)
      if (!t.isCallExpression(value) || !t.isIdentifier(value.callee)) {
        continue
      }
      if (value.callee.name === callName) {
        mainStatements.push(statement)
      }
      if (value.callee.name === 'defineMetadata') {
        metadataCalls.push(value)
      }
    }
    if (!callName || mainStatements.length !== 1) {
      return { ok: false, diagnostics: [error('document-metadata-definition', `Source должен содержать ровно один ${callName ?? 'definition'}(...).`, 'source', mainStatements[1] ?? mainStatements[0])] }
    }
    const call = unwrap(mainStatements[0].expression) as t.CallExpression
    const argument = call.arguments[0]
    const definition = argument && t.isObjectExpression(argument) ? argument : null
    if (!definition) {
      return { ok: false, diagnostics: [error('document-metadata-definition-argument', `${callName} требует статическое определение.`, 'source', call)] }
    }
    return { ok: true, definition, mainStatement: mainStatements[0], metadataCalls, diagnostics: [] }
  }
  catch (cause) {
    const value = cause as { message?: string, pos?: number }
    return { ok: false, diagnostics: [{ severity: 'error', code: 'document-metadata-parse-error', message: `Не удалось разобрать Source: ${value.message ?? String(cause)}`, sourcePath: 'source', start: value.pos }] }
  }
}

function metadataProperties(definition: t.ObjectExpression): t.ObjectProperty[] {
  return definition.properties.filter((item): item is t.ObjectProperty => t.isObjectProperty(item) && propertyName(item.key) === 'metadata')
}

function propertyName(node: t.Expression | t.Identifier | t.PrivateName | t.PatternLike): string | null {
  if (t.isIdentifier(node)) {
    return node.name
  }
  if (t.isStringLiteral(node) || t.isNumericLiteral(node)) {
    return String(node.value)
  }
  return null
}

function unwrap(expression: t.Expression): t.Expression {
  let current = expression
  while (t.isTSAsExpression(current) || t.isTSSatisfiesExpression(current) || t.isTypeCastExpression(current) || t.isParenthesizedExpression(current)) {
    current = current.expression
  }
  return current
}

function projection(
  backing: DocumentMetadataProjection['backing'],
  mode: DocumentMetadataProjection['mode'],
  editable: boolean,
  metadata: ProgramMetadataMap,
  diagnostics: DocumentMetadataDiagnostic[],
  sourceRange: DocumentMetadataProjection['sourceRange'],
  message?: string,
): DocumentMetadataProjection {
  return { backing, mode, editable, metadata, json: serialize(metadata), sourceRange, diagnostics, ...(message ? { message } : {}) }
}

function success(previousSource: string, previousMeta: Record<string, unknown>, source: string, meta: Record<string, unknown>, projectionValue: DocumentMetadataProjection): DocumentMetadataPatchResult {
  return { ok: true, source, meta, changed: source !== previousSource || serialize(meta) !== serialize(previousMeta), projection: projectionValue, diagnostics: projectionValue.diagnostics }
}

function failure(source: string, meta: Record<string, unknown>, projectionValue: DocumentMetadataProjection, diagnostics: DocumentMetadataDiagnostic[], message?: string): DocumentMetadataPatchResult {
  return { ok: false, source, meta, changed: false, projection: projectionValue, diagnostics, ...(message ? { message } : {}) }
}

function error(code: string, message: string, sourcePath: string, node?: Node | { start: number, end: number } | null): DocumentMetadataDiagnostic {
  return { severity: 'error', code, message, sourcePath, ...(node && typeof node.start === 'number' ? { start: node.start } : {}), ...(node && typeof node.end === 'number' ? { end: node.end } : {}) }
}

function range(node: Node | null | undefined): { start: number, end: number } | null {
  return node && typeof node.start === 'number' && typeof node.end === 'number' ? { start: node.start, end: node.end } : null
}

function lineIndent(source: string, offset: number): string {
  const start = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
  return source.slice(start, offset).match(/^\s*/)?.[0] ?? ''
}

function indentJSON(value: ProgramMetadataMap, indent: string): string {
  return serialize(value).split('\n').map((line, index) => index ? `${indent}${line}` : line).join('\n')
}

function replace(source: string, start: number, end: number, value: string): string {
  return `${source.slice(0, start)}${value}${source.slice(end)}`
}

function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2)
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
function cloneRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? cloneJSON(value) : {}
}
function cloneJSON<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function validateMetadataValue(value: unknown): string | null {
  if (!isRecord(value)) {
    return 'Metadata должна быть JSON-объектом верхнего уровня.'
  }
  return validateJSONValue(value, new WeakSet()) ? null : 'Metadata должна содержать только конечные JSON-compatible значения без циклических ссылок.'
}

function validateJSONValue(value: unknown, ancestors: WeakSet<object>): boolean {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') {
    return true
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }
  if (typeof value !== 'object') {
    return false
  }
  if (ancestors.has(value)) {
    return false
  }
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return value.every(item => validateJSONValue(item, ancestors))
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      return false
    }
    return Object.values(value as Record<string, unknown>).every(item => validateJSONValue(item, ancestors))
  }
  finally {
    ancestors.delete(value)
  }
}
