import type { QueryGraphQLErrorPolicy } from '@/features/core/modules/source/domain/types/query-source.types'

// Позиция GraphQL error в документе операции.
export interface GraphQLResponseErrorLocation {
  line: number
  column: number
}

// Полная форма элемента errors из GraphQL response; неизвестные поля сервера сохраняются.
export interface GraphQLResponseError {
  // Текст ошибки; при отсутствии в ответе заменяется JSON-представлением элемента.
  message: string

  // Путь к полю ответа, на котором возникла ошибка.
  path?: ReadonlyArray<string | number>

  // Позиции в GraphQL document.
  locations?: ReadonlyArray<GraphQLResponseErrorLocation>

  // Серверные расширения, например extensions.code.
  extensions?: Record<string, unknown>

  [key: string]: unknown
}

// Сведения об операции, в которой GraphQL вернул ошибку.
export interface GraphQLQueryErrorRequest {
  url: string
  operationName?: string
  status?: number
}

/**
 * Ошибка GraphQL Query при errorPolicy: 'throw': ответ HTTP 2xx содержит errors.
 * Хранит полные errors и частичные data ответа.
 */
export class GraphQLQueryError extends Error {
  public readonly code = 'graphql_query_error'
  public readonly errors: readonly GraphQLResponseError[]
  public readonly data: unknown
  public readonly url: string
  public readonly operationName?: string
  public readonly status?: number

  public constructor(
    errors: readonly GraphQLResponseError[],
    data: unknown,
    request: GraphQLQueryErrorRequest,
  ) {
    super(`[GraphQL] ${formatGraphQLResponseErrors(errors)}`)
    this.name = 'GraphQLQueryError'
    this.errors = errors
    this.data = data
    this.url = request.url
    this.operationName = request.operationName
    this.status = request.status
  }
}

/**
 * Ответ GraphQL endpoint с HTTP 2xx не является JSON-объектом GraphQL response.
 */
export class GraphQLResponseFormatError extends Error {
  public readonly code = 'graphql_response_format_error'
  // Причина без префикса операции, для отчётов транспорта.
  public readonly reason: string
  public readonly url: string
  public readonly operationName?: string
  public readonly status?: number
  public readonly contentType?: string

  public constructor(
    reason: string,
    request: GraphQLQueryErrorRequest & { contentType?: string },
  ) {
    const operation = request.operationName ? ` ${request.operationName}` : ''
    super(`[GraphQL] Invalid response${operation} at ${request.url}: ${reason}`)
    this.name = 'GraphQLResponseFormatError'
    this.reason = reason
    this.url = request.url
    this.operationName = request.operationName
    this.status = request.status
    this.contentType = request.contentType
  }
}

// Склеивает сообщения errors с путём поля для статуса и логов Query.
export function formatGraphQLResponseErrors(errors: readonly GraphQLResponseError[]): string {
  return errors
    .map(error => error.path?.length ? `${error.message} (path: ${error.path.join('.')})` : error.message)
    .join('; ')
}

// Разобранный GraphQL ExecutionResult: data (null, если отсутствует) и нормализованные errors.
export interface GraphQLExecutionResult {
  data: unknown
  errors: GraphQLResponseError[]
}

/**
 * Проверяет оболочку GraphQL ExecutionResult (ответ Query или событие next подписки):
 * JSON-объект с data и/или массивом errors. Иначе выбрасывает GraphQLResponseFormatError.
 */
export function readGraphQLExecutionResult(
  body: unknown,
  request: GraphQLQueryErrorRequest & { contentType?: string },
): GraphQLExecutionResult {
  const fail = (reason: string): never => {
    throw new GraphQLResponseFormatError(reason, request)
  }
  if (typeof body === 'string') {
    fail(`body is not JSON${request.contentType ? ` (content-type: ${request.contentType})` : ''}`)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail(`body must be a JSON object, received ${body === null ? 'null' : Array.isArray(body) ? 'array' : typeof body}`)
  }
  const envelope = body as Record<string, unknown>
  const hasData = Object.hasOwn(envelope, 'data')
  const hasErrors = Object.hasOwn(envelope, 'errors') && envelope.errors != null
  if (!hasData && !hasErrors) {
    fail('body must contain "data" or "errors"')
  }
  if (hasErrors && !Array.isArray(envelope.errors)) {
    fail('"errors" must be an array')
  }
  const errors = hasErrors
    ? (envelope.errors as unknown[]).map(normalizeGraphQLResponseError)
    : []
  return { data: envelope.data ?? null, errors }
}

// Сохраняет полную форму GraphQL error и гарантирует строковый message.
export function normalizeGraphQLResponseError(error: unknown): GraphQLResponseError {
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    return { message: typeof error === 'string' ? error : JSON.stringify(error) }
  }
  const entry = error as Record<string, unknown>
  return {
    ...entry,
    message: typeof entry.message === 'string' ? entry.message : JSON.stringify(error),
  }
}

// Решение по событию next GraphQL-подписки после errorPolicy.
export type GraphQLNextRouting
  = | { kind: 'publish', data: unknown, graphQLErrors?: GraphQLResponseError[] }
    | { kind: 'error', error: GraphQLQueryError }
    | { kind: 'skip' }

/**
 * errorPolicy события next (транспорт graphqlSse и mockStream Simulation):
 * без errors публикуется data; 'throw' — GraphQLQueryError с частичными data;
 * 'ignore' — data без errors; 'all' — data и errors (без data — только errors для diagnostics).
 */
export function routeGraphQLNextResult(
  result: GraphQLExecutionResult,
  errorPolicy: QueryGraphQLErrorPolicy,
  request: GraphQLQueryErrorRequest,
): GraphQLNextRouting {
  if (result.errors.length === 0) {
    return { kind: 'publish', data: result.data }
  }
  if (errorPolicy === 'throw') {
    return { kind: 'error', error: new GraphQLQueryError(result.errors, result.data, request) }
  }
  if (result.data == null) {
    // ignore/all: без data событие не публикуется; при all errors сообщаются отдельно.
    return errorPolicy === 'all' ? { kind: 'publish', data: undefined, graphQLErrors: result.errors } : { kind: 'skip' }
  }
  return { kind: 'publish', data: result.data, ...(errorPolicy === 'all' ? { graphQLErrors: result.errors } : {}) }
}
