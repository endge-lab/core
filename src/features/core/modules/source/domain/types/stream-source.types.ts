import type { ProgramMetadataMap } from '@/features/core/modules/program/domain/types/program-metadata.types'
import type { ProgramDiagnostic } from '@/features/core/modules/program/domain/types/program.types'
import type { GraphQLResponseError } from '@/features/core/modules/runtime/domain/graphql-query-error'
import type { GraphQLDocumentFragments } from '@/features/core/modules/source/domain/types/graphql-fragments.types'
import type { QueryGraphQLErrorPolicy } from '@/features/core/modules/source/domain/types/query-source.types'
import type { QueryProgramProp, SourceExpressionIR } from '@/features/core/modules/source/domain/types/source-expression.types'

export interface StreamSseTransportDescriptor {
  kind: 'sse'
  url: string
  withCredentials: boolean
  authMode: 'inherit' | 'profile' | 'none'
  authProfileIdentity: string | null
}

export type StreamJsonValue = string | number | boolean | null | StreamJsonValue[] | { [key: string]: StreamJsonValue }

export interface StreamWebSocketTransportDescriptor {
  kind: 'websocket'
  url: string
  onOpen: StreamJsonValue[]
}

/**
 * GraphQL subscription по протоколу graphql-sse (distinct connections mode):
 * одно HTTP-соединение на подписку, события next (ExecutionResult) и complete.
 */
export interface StreamGraphQLSseTransportDescriptor {
  kind: 'graphql-sse'
  // Строка или workspace token {VAR}; разрешается runtime перед открытием.
  // Пусто, если url задан выражением (`urlExpression`).
  url: string
  // url как выражение по props и env (`prop('endpoint')`, шаблонная строка); вычисляется при каждом подключении.
  urlExpression?: SourceExpressionIR
  // POST: JSON-тело { query, operationName?, variables }; GET: те же параметры в query string.
  method: 'POST' | 'GET'
  // Статический текст subscription operation; фрагменты из `fragments` уже подставлены.
  document: string
  // Исходный document и все варианты фрагментов — только в source document, в artifact не попадает.
  fragments?: GraphQLDocumentFragments
  operationName?: string
  // variables(callback) по props Stream; null — пустой объект.
  variables: SourceExpressionIR | null
  // Заголовки запроса: object literal, допускающий prop('key') и env('NAME').
  headers: SourceExpressionIR | null
  // extensions запроса graphql-sse (object literal, prop('key') и env('NAME')); поле отсутствует, если не задано.
  extensions?: SourceExpressionIR
  withCredentials: boolean
  authMode: 'inherit' | 'profile' | 'none'
  authProfileIdentity: string | null
  // Обработка errors в событиях next, как request.errorPolicy GraphQL Query.
  errorPolicy: QueryGraphQLErrorPolicy
  // Задержка переподключения после обрыва или ошибки, мс.
  reconnectDelayMs: number
}

export type StreamTransportDescriptor = StreamSseTransportDescriptor | StreamWebSocketTransportDescriptor | StreamGraphQLSseTransportDescriptor

// Объявленный prop Stream: тот же контракт поля, что у props Query.
export type StreamProgramProp = QueryProgramProp

export interface StreamEventDescriptor {
  sourceEvent: string
  type: string | null
  typePath: string | null
  payloadPath: string | null
  // Точные значения по dot-path исходного сообщения, проверяемые до eachFrom.
  match?: Record<string, string | number | boolean | null>
  // Путь к массиву; typePath и payloadPath читаются относительно каждого элемента.
  eachFrom?: string
}

export interface StreamSourceDocument {
  // Входные props Stream (сейчас используются только transport graphqlSse); поле отсутствует, если props не объявлены.
  props?: StreamProgramProp[]
  transport: StreamTransportDescriptor
  events: StreamEventDescriptor[]
}

// Готовый для runtime артефакт Stream.
export interface StreamSourceArtifact extends StreamSourceDocument {
  // Optional parser tree retained for inspection; runtime does not require it.
  ast?: unknown
  type: 'stream'
  sourceVersion: number
}

export interface StreamSourceCompileResult {
  ast: unknown | null
  document: StreamSourceDocument | null
  artifact: StreamSourceArtifact | null
  metadata: ProgramMetadataMap
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
}

export interface StreamEventEnvelope {
  type: string
  payload: unknown
  meta: {
    id: string | null
    source: string
    sourceEvent: string
    occurredAt: string
    // GraphQL errors события next при errorPolicy: 'all'; отсутствует, если errors нет.
    graphQLErrors?: readonly GraphQLResponseError[]
  }
}
