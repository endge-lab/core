import type { GraphQLResponseError } from '@/features/core/modules/runtime/domain/graphql-query-error'
import type { StreamSourceArtifact } from '@/features/core/modules/source/domain/types/stream-source.types'

export interface StreamTransportMessage {
  sourceEvent: string
  id: string | null
  data: unknown
  // GraphQL errors события next при errorPolicy: 'all'.
  graphQLErrors?: readonly GraphQLResponseError[]
}

export interface StreamTransportConnection {
  close: () => void | Promise<void>
  pause?: () => Promise<void>
  resume?: () => Promise<void>
}

// Значения запроса, вычисленные host из props Stream перед открытием транспорта.
export interface StreamTransportRequest {
  variables?: Record<string, unknown>
  headers?: Record<string, string>
  // extensions запроса graphql-sse; не передаются, если не заданы в Source.
  extensions?: Record<string, unknown>
}

// Нейтральный к браузеру порт, используемый StreamRuntimeHost.
export interface StreamTransportFactory {
  open: (
    artifact: StreamSourceArtifact,
    callbacks: {
      message: (message: StreamTransportMessage) => void
      error: (error: unknown) => void
      open: () => void
    },
    request?: StreamTransportRequest,
  ) => StreamTransportConnection
}
