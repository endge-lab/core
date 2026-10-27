import type { RQueryAuth } from '@/features/core/modules/domain/types/document/query.types'
import type { ProgramMetadataMap } from '@/features/core/modules/program/domain/types/program-metadata.types'
import type { ProgramDiagnostic, QueryProgramPayload } from '@/features/core/modules/program/domain/types/program.types'
import type { DataViewRef } from '@/features/core/modules/source/domain/types/data-view-source.types'
import type { GraphQLDocumentFragments } from '@/features/core/modules/source/domain/types/graphql-fragments.types'
import type { ResponseOutputTransform } from '@/features/core/modules/source/domain/types/response-output.types'
import type { QueryProgramProp, SourceExpressionIR, SourceFieldDefinition } from '@/features/core/modules/source/domain/types/source-expression.types'

// Поддерживаемые transport-kind Query source.
export type QuerySourceKind = 'rest' | 'graphql'

// Политика GraphQL errors в HTTP 2xx response.
// throw: ответ с errors завершает Query ошибкой GraphQLQueryError с частичными data;
// ignore: data возвращаются, errors доступны выходам через errors(path?) без отчёта;
// all: data и errors возвращаются, errors доступны через errors(path?) и пишутся warning в diagnostics.
export type QueryGraphQLErrorPolicy = 'throw' | 'ignore' | 'all'

// Статическое значение запроса или безопасное выражение, вычисляемое из props Query в runtime.
export type QuerySourceRequestValue<T> = T | SourceExpressionIR

// Source-описание HTTP request части REST-запроса.
export interface QuerySourceRestRequest {
  // Endpoint или Endge var-token вида {API_URL}.
  endpoint: QuerySourceRequestValue<string>

  // REST path. В legacy RQuery это поле хранится как query.
  path: QuerySourceRequestValue<string>

  // Метод HTTP.
  method: QuerySourceRequestValue<string>

  // Заголовки HTTP.
  headers: QuerySourceRequestValue<Record<string, string>>

  // Конфигурация авторизации.
  auth: QuerySourceRequestValue<RQueryAuth>

  // Таймаут запроса.
  timeoutMs?: QuerySourceRequestValue<number>

  // Отправлять body как application/x-www-form-urlencoded.
  formUrlencoded?: QuerySourceRequestValue<boolean>

  // Безопасный body expression для query source v2.
  body?: SourceExpressionIR | null
}

// Source-описание GraphQL operation и variables.
export interface QuerySourceGraphQLRequest {
  // GraphQL endpoint или Endge var-token вида {API_URL}.
  endpoint: QuerySourceRequestValue<string>

  // Статический GraphQL document из gql template; фрагменты из `fragments` уже подставлены.
  document: string

  // Исходный document operation и все варианты фрагментов (`request.fragments`) — для проверки редактором.
  fragments?: GraphQLDocumentFragments

  // Operation name для document с несколькими operations.
  operationName?: string

  // Безопасное variables expression, построенное через variables(...).
  variables?: SourceExpressionIR | null

  // Дополнительные HTTP headers.
  headers: QuerySourceRequestValue<Record<string, string>>

  // Конфигурация авторизации.
  auth: QuerySourceRequestValue<RQueryAuth>

  // Таймаут запроса.
  timeoutMs?: QuerySourceRequestValue<number>

  // Обработка GraphQL errors в HTTP 2xx response.
  errorPolicy: QueryGraphQLErrorPolicy
}

// Source-описание mock-режима запроса.
export interface QuerySourceMock {
  // Включены ли mock data.
  enabled: boolean

  // Mock-данные. Для GraphQL — data операции.
  data: unknown

  // Только GraphQL: errors mock-ответа; обрабатываются по errorPolicy как ответ сервера.
  errors?: unknown[]
}

export type QueryOutputSource
  = | {
    type: 'response'
    path: string | null
    expression?: SourceExpressionIR
  }
  | {
    type: 'output'
    key: string
  }

export interface QuerySourceOutput {
  key: string
  source: QueryOutputSource
  // Упорядоченная цепочка transform.
  transforms: ResponseOutputTransform[]
  // Проекция совместимости, содержащая только transforms DataView.
  dataViews: DataViewRef[]
  contract?: SourceFieldDefinition | null
}

export type QuerySourceOutputs = QuerySourceOutput[]

interface QuerySourceDocumentBase {
  // Единственный runtime input contract Query.
  props: QueryProgramProp[]

  // Упорядоченный выходной граф: источники response/output и преобразования.
  outputs: QuerySourceOutputs

  // Конфигурация mock.
  mock: QuerySourceMock
}

export interface QuerySourceRestDocument extends QuerySourceDocumentBase {
  kind: 'rest'
  request: QuerySourceRestRequest
}

export interface QuerySourceGraphQLDocument extends QuerySourceDocumentBase {
  kind: 'graphql'
  request: QuerySourceGraphQLRequest
}

// Canonical authoring-модель source-only Query v2.
export type QuerySourceDocument = QuerySourceRestDocument | QuerySourceGraphQLDocument

// Публичные editor-slots, которые query source patcher умеет менять точечно.
export type QuerySourcePatchPath
  = | 'kind'
    | 'request.endpoint'
    | 'request.path'
    | 'request.method'
    | 'request.headers'
    | 'request.auth'
    | 'request.timeoutMs'
    | 'request.formUrlencoded'
    | 'request.body'
    | 'props'
    | 'outputs'
    | 'mock.enabled'
    | 'mock.data'

// Операция AST-патчинга query source.
export interface QuerySourcePatchOperation {
  // Изменяемый editor-slot.
  path: QuerySourcePatchPath

  // Новое normalized значение, если patcher должен сам напечатать expression.
  value?: unknown

  // Готовое source-expression для сложных DSL-значений: env(...), field(...), filter...
  expression?: string
}

// Patch query source: одиночная операция или пачка операций.
export type QuerySourcePatch = QuerySourcePatchOperation | QuerySourcePatchOperation[]

// Результат компиляции query source.
export interface QuerySourceCompileResult {
  // AST уровня parser.
  ast: unknown | null

  // Canonical authoring-модель.
  document: QuerySourceDocument | null

  // Query artifact payload для Endge.program.
  artifact: QueryProgramPayload | null

  // Публичная metadata, извлечённая из canonical source.
  metadata: ProgramMetadataMap

  // Diagnostics source compiler-а.
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
}
