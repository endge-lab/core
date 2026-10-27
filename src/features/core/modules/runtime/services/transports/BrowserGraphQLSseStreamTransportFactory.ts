import type {
  StreamTransportConnection,
  StreamTransportFactory,
} from '@/features/core/modules/runtime/domain/stream-runtime.types'
import type { ResolveAuthSession } from '@/features/core/modules/runtime/services/transports/BrowserSseStreamTransportFactory'

import { SSEManager } from '@endge/utils'

import { readGraphQLExecutionResult, routeGraphQLNextResult } from '@/features/core/modules/runtime/domain/graphql-query-error'
import { createSseAuthTokenProvider } from '@/features/core/modules/runtime/services/transports/BrowserSseStreamTransportFactory'

/**
 * HTTP 4xx ответа graphql-sse: подписка остановлена без переподключения.
 */
export class GraphQLSseHttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly url: string,
    cause?: unknown,
  ) {
    super(`[graphql-sse] HTTP ${status} from "${url}": subscription stopped without reconnect.`, { cause })
    this.name = 'GraphQLSseHttpError'
  }
}

// 408 Request Timeout и 429 Too Many Requests — временные: переподключение, как для 5xx.
const TRANSIENT_HTTP_STATUSES: ReadonlySet<number> = new Set([408, 429])

// Статус HTTP из ошибки SSEManager («Unexpected response: 401») или поля status.
export function readSseHttpStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null | undefined)?.status
  if (typeof status === 'number' && Number.isInteger(status)) {
    return status
  }
  const match = /unexpected response:\s*(\d{3})\b/i.exec(String((error as Error | undefined)?.message ?? error))
  return match ? Number(match[1]) : null
}

/**
 * GraphQL subscription по протоколу graphql-sse, режим distinct connections:
 * одно fetch-соединение на подписку, события next (ExecutionResult) и complete.
 * Событие next публикует data результата; complete закрывает соединение без переподключения.
 * Обрыв без complete, сетевые ошибки, HTTP 5xx, 408 и 429 переподключаются через reconnectDelayMs.
 * Остальные HTTP 4xx останавливают подписку с ошибкой; 401 при auth — один повтор с обновлённым
 * токеном (счётчик сбрасывается после успешного открытия).
 */
export class BrowserGraphQLSseStreamTransportFactory implements StreamTransportFactory {
  public constructor(private readonly _resolveAuthSession: ResolveAuthSession) {}

  public open(
    artifact: Parameters<StreamTransportFactory['open']>[0],
    callbacks: Parameters<StreamTransportFactory['open']>[1],
    request: Parameters<StreamTransportFactory['open']>[2] = {},
  ): StreamTransportConnection {
    const transport = artifact.transport
    if (transport.kind !== 'graphql-sse') {
      throw new Error(`Unsupported Stream transport: ${transport.kind}`)
    }
    const params: GraphQLSseParams = {
      query: transport.document,
      ...(transport.operationName ? { operationName: transport.operationName } : {}),
      variables: request.variables ?? {},
      ...(request.extensions && Object.keys(request.extensions).length > 0 ? { extensions: request.extensions } : {}),
    }
    const isGet = transport.method === 'GET'
    const url = isGet ? appendGraphQLParams(transport.url, params) : transport.url
    const token = transport.authMode === 'none'
      ? null
      : createSseAuthTokenProvider(this._resolveAuthSession, transport)
    const hasComplete = artifact.events.some(event => event.sourceEvent === 'complete')
    const errorRequest = { url: transport.url, operationName: transport.operationName }

    let unauthorizedRetried = false

    const manager: SSEManager = new SSEManager({
      url,
      method: transport.method,
      ...(isGet ? {} : { body: JSON.stringify(params) }),
      headers: {
        ...(isGet ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
        ...request.headers,
      },
      withCredentials: transport.withCredentials,
      retryInterval: transport.reconnectDelayMs,
      ...(token ? { getToken: token.getToken } : {}),
      onOpen: () => {
        unauthorizedRetried = false
        callbacks.open()
      },
      onError: (error) => {
        token?.onError(error)
        const status = readSseHttpStatus(error)
        if (status === null || status < 400 || status >= 500 || TRANSIENT_HTTP_STATUSES.has(status)) {
          callbacks.error(error)
          return
        }
        if (status === 401 && token && !unauthorizedRetried) {
          // Токен мог истечь: следующее подключение запросит его с forceRefresh.
          unauthorizedRetried = true
          callbacks.error(error)
          return
        }
        // Остальные 4xx не исправятся повтором тех же параметров.
        manager.stop()
        callbacks.error(new GraphQLSseHttpError(status, transport.url, error))
      },
      onMessage: (message) => {
        if (message.event === 'complete') {
          // Сервер завершил подписку: повторное подключение создало бы новую подписку.
          manager.stop()
          if (hasComplete) {
            callbacks.message({ sourceEvent: 'complete', id: message.id, data: null })
          }
          return
        }
        if (message.event !== 'next') {
          return
        }
        let result: ReturnType<typeof readGraphQLExecutionResult>
        try {
          result = readGraphQLExecutionResult(message.data, errorRequest)
        }
        catch (error) {
          callbacks.error(error)
          return
        }
        const routing = routeGraphQLNextResult(result, transport.errorPolicy, errorRequest)
        if (routing.kind === 'error') {
          callbacks.error(routing.error)
        }
        else if (routing.kind === 'publish') {
          callbacks.message({
            sourceEvent: 'next',
            id: message.id,
            data: routing.data,
            ...(routing.graphQLErrors ? { graphQLErrors: routing.graphQLErrors } : {}),
          })
        }
      },
    })
    manager.start()
    return { close: () => manager.stop() }
  }
}

interface GraphQLSseParams {
  query: string
  operationName?: string
  variables: Record<string, unknown>
  extensions?: Record<string, unknown>
}

// GET-режим graphql-sse: query, operationName, JSON variables и extensions в query string.
function appendGraphQLParams(url: string, params: GraphQLSseParams): string {
  const search = new URLSearchParams()
  search.set('query', params.query)
  if (params.operationName) {
    search.set('operationName', params.operationName)
  }
  if (Object.keys(params.variables).length > 0) {
    search.set('variables', JSON.stringify(params.variables))
  }
  if (params.extensions) {
    search.set('extensions', JSON.stringify(params.extensions))
  }
  const hashIndex = url.indexOf('#')
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex)
  return `${base}${base.includes('?') ? '&' : '?'}${search.toString()}${hash}`
}
