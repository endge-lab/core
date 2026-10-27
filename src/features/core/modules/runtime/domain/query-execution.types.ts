import type { QueryProgramPayload } from '@/features/core/modules/program/domain/types/program.types'
import type { GraphQLResponseError } from '@/features/core/modules/runtime/domain/graphql-query-error'

// Итоговый HTTP-запрос Query после вычисления props, переменных окружения и auth.
// Значения передаются как есть: потребитель, показывающий запрос, сам скрывает секреты.
export interface QueryExecutionRequest {
  protocol: 'REST' | 'GraphQL'
  method: string
  url: string
  headers: Record<string, string>
  // Query-параметры URL (GET/DELETE body REST и auth sendAs: 'query').
  params: Record<string, unknown>
  // Тело запроса: JSON-объект, URLSearchParams form или undefined для GET/DELETE.
  body?: unknown
  operationName?: string
  timeoutMs?: number
  // Имена заголовков и query-параметров, заполненных auth профилем: всегда секретны.
  authHeaders: string[]
  authParams: string[]
}

// HTTP-ответ транспорта до разбора GraphQL errors и чтения outputs.
export interface QueryExecutionResponse {
  status?: number
  statusText?: string
  headers: Record<string, string>
  data: unknown
}

// Наблюдатель одного выполнения: только чтение, на результат не влияет.
export interface QueryExecutionObserver {
  // Вызывается непосредственно перед отправкой HTTP-запроса; mock и Simulation его не вызывают.
  onRequest?: (request: QueryExecutionRequest) => void
  // Вызывается при получении HTTP-ответа, в том числе с кодом ошибки.
  onResponse?: (response: QueryExecutionResponse) => void
}

// Runtime context одного выполнения compiled query artifact.
export interface QueryExecutionContext extends QueryExecutionObserver {
  // Runtime-ready query payload из Endge.program.
  payload: QueryProgramPayload

  // Входные параметры одноразового или реактивного запуска.
  vars?: Record<string, unknown>

  // AbortSignal текущего runtime run.
  signal?: AbortSignal

  // Получает полные GraphQL errors принятого ответа: пустой массив без errors,
  // непустой только при errorPolicy 'all'. REST и mock не вызывают callback.
  onGraphQLErrors?: (errors: readonly GraphQLResponseError[]) => void
}
