import type { ASTNode, GraphQLError, IntrospectionOptions, IntrospectionQuery } from 'graphql'

import {
  buildClientSchema,
  buildSchema,
  getIntrospectionQuery,
  getLocation,
  GraphQLError as GraphQLErrorClass,
  GraphQLSchema,
  parse,
  Source,
  validate,
  validateSchema,
} from 'graphql'

// Результат introspection-запроса: ответ endpoint `{ data: { __schema } }` или сам `{ __schema }`.
export type GraphQLIntrospectionResult
  = | IntrospectionQuery
    | { data?: IntrospectionQuery | null, errors?: readonly unknown[] }

// Сохранённая схема GraphQL: SDL, JSON introspection (строкой или объектом) или готовая GraphQLSchema.
export type GraphQLSchemaInput = string | GraphQLSchema | GraphQLIntrospectionResult

// Диагностика проверки схемы или документа GraphQL без привязки к UI.
// Позиции относятся к тексту GraphQL document (line/column с 1, offset с 0).
export interface GraphQLDocumentDiagnostic {
  severity: 'error' | 'warning'
  code: string
  message: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  offset?: number
  length?: number
}

// Загруженная схема или причины, по которым её нельзя использовать.
export interface GraphQLSchemaLoadResult {
  schema: GraphQLSchema | null
  // Как схема была получена.
  format: 'schema' | 'sdl' | 'introspection' | null
  diagnostics: GraphQLDocumentDiagnostic[]
}

const objectSchemaCache = new WeakMap<object, GraphQLSchemaLoadResult>()
let lastStringSchema: { source: string, result: GraphQLSchemaLoadResult } | null = null

/**
 * Возвращает текст стандартного introspection-запроса для загрузки схемы с endpoint.
 * По умолчанию запрашивает descriptions и не использует расширения, которые поддерживают не все серверы.
 */
export function createGraphQLIntrospectionQuery(options?: IntrospectionOptions): string {
  return getIntrospectionQuery({ descriptions: true, ...options })
}

/**
 * Строит GraphQLSchema из SDL или результата introspection без обращения к сети.
 * Результат для одного и того же объекта (и последней строки) кэшируется.
 */
export function loadGraphQLSchema(input: GraphQLSchemaInput): GraphQLSchemaLoadResult {
  if (input instanceof GraphQLSchema) {
    return withSchemaValidation(input, 'schema')
  }
  if (typeof input === 'string') {
    if (lastStringSchema?.source === input) {
      return lastStringSchema.result
    }
    const result = loadGraphQLSchemaText(input)
    lastStringSchema = { source: input, result }
    return result
  }
  if (input != null && typeof input === 'object') {
    const cached = objectSchemaCache.get(input)
    if (cached) {
      return cached
    }
    const result = loadGraphQLIntrospection(input)
    objectSchemaCache.set(input, result)
    return result
  }
  return failure('introspection', schemaDiagnostic('graphql-schema-input', 'Схема GraphQL должна быть SDL, JSON introspection или GraphQLSchema.'))
}

/**
 * Проверяет GraphQL document по сохранённой схеме: синтаксис и стандартные правила спецификации
 * (поля, аргументы, типы и использование переменных, фрагменты). Сеть не используется.
 */
export function validateGraphQLDocument(schema: GraphQLSchemaInput, source: string): GraphQLDocumentDiagnostic[] {
  if (!source.trim()) {
    return []
  }
  const loaded = loadGraphQLSchema(schema)
  if (!loaded.schema) {
    return loaded.diagnostics.map(diagnostic => ({ ...diagnostic }))
  }

  const documentSource = new Source(source)
  let document
  try {
    document = parse(documentSource)
  }
  catch (error) {
    return [graphQLErrorDiagnostic(error, documentSource, 'graphql-document-syntax')]
  }
  return validate(loaded.schema, document)
    .map(error => graphQLErrorDiagnostic(error, documentSource, 'graphql-document-validation'))
}

function loadGraphQLSchemaText(text: string): GraphQLSchemaLoadResult {
  const trimmed = text.trim()
  if (!trimmed) {
    return failure('sdl', schemaDiagnostic('graphql-schema-empty', 'Схема GraphQL пуста.'))
  }
  if (trimmed.startsWith('{')) {
    let value: unknown
    try {
      value = JSON.parse(trimmed)
    }
    catch (error) {
      return failure('introspection', schemaDiagnostic(
        'graphql-schema-introspection-json',
        `Некорректный JSON introspection: ${error instanceof Error ? error.message : String(error)}`,
      ))
    }
    return loadGraphQLIntrospection(value)
  }

  const source = new Source(text)
  try {
    return withSchemaValidation(buildSchema(source), 'sdl')
  }
  catch (error) {
    const code = error instanceof GraphQLErrorClass && error.message.startsWith('Syntax Error')
      ? 'graphql-schema-syntax'
      : 'graphql-schema-invalid'
    return failure('sdl', graphQLErrorDiagnostic(error, source, code))
  }
}

function loadGraphQLIntrospection(value: unknown): GraphQLSchemaLoadResult {
  if (value == null || typeof value !== 'object') {
    return failure('introspection', schemaDiagnostic('graphql-schema-introspection-shape', 'Ожидается JSON introspection вида { data: { __schema } } или { __schema }.'))
  }
  const record = value as Record<string, unknown>
  const data = '__schema' in record ? record : record.data
  if (data == null || typeof data !== 'object' || !('__schema' in data)) {
    const errors = Array.isArray(record.errors) ? record.errors : []
    if (errors.length) {
      const messages = errors.map(item => item != null && typeof item === 'object' && typeof (item as { message?: unknown }).message === 'string'
        ? (item as { message: string }).message
        : String(item))
      return failure('introspection', schemaDiagnostic('graphql-schema-introspection-errors', `Introspection вернул ошибки: ${messages.join('; ')}`))
    }
    return failure('introspection', schemaDiagnostic('graphql-schema-introspection-shape', 'Ожидается JSON introspection вида { data: { __schema } } или { __schema }.'))
  }
  try {
    return withSchemaValidation(buildClientSchema(data as IntrospectionQuery), 'introspection')
  }
  catch (error) {
    return failure('introspection', schemaDiagnostic(
      'graphql-schema-invalid',
      `Некорректный результат introspection: ${error instanceof Error ? error.message : String(error)}`,
    ))
  }
}

function withSchemaValidation(schema: GraphQLSchema, format: GraphQLSchemaLoadResult['format']): GraphQLSchemaLoadResult {
  const errors = validateSchema(schema)
  if (errors.length) {
    return {
      schema: null,
      format,
      diagnostics: errors.map(error => schemaDiagnostic('graphql-schema-invalid', error.message)),
    }
  }
  return { schema, format, diagnostics: [] }
}

function failure(format: GraphQLSchemaLoadResult['format'], diagnostic: GraphQLDocumentDiagnostic): GraphQLSchemaLoadResult {
  return { schema: null, format, diagnostics: [diagnostic] }
}

function schemaDiagnostic(code: string, message: string): GraphQLDocumentDiagnostic {
  return { severity: 'error', code, message }
}

function graphQLErrorDiagnostic(error: unknown, source: Source, code: string): GraphQLDocumentDiagnostic {
  const diagnostic: GraphQLDocumentDiagnostic = {
    severity: 'error',
    code,
    message: error instanceof Error ? error.message : String(error),
  }
  if (!(error instanceof GraphQLErrorClass)) {
    return diagnostic
  }
  const range = graphQLErrorRange(error, source)
  if (!range) {
    return diagnostic
  }
  const start = getLocation(source, range.start)
  const end = getLocation(source, range.end)
  return {
    ...diagnostic,
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
    offset: range.start,
    length: range.end - range.start,
  }
}

// Диапазон первой AST-ноды ошибки; для синтаксических ошибок — один символ в позиции ошибки.
function graphQLErrorRange(error: GraphQLError, source: Source): { start: number, end: number } | null {
  const node = (error.nodes as readonly ASTNode[] | undefined)?.find(item => item.loc)
  if (node?.loc && node.loc.source.body === source.body) {
    // Для поля/аргумента выделяем имя, а не всё selection set.
    const name = 'name' in node && node.name && typeof node.name === 'object' && 'loc' in node.name ? node.name.loc : undefined
    const loc = name ?? node.loc
    return { start: loc.start, end: Math.max(loc.end, loc.start + 1) }
  }
  const position = error.positions?.[0]
  if (position == null) {
    return null
  }
  return { start: position, end: Math.min(position + 1, Math.max(source.body.length, position)) }
}
