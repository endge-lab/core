import type { RQueryAuth } from '@/domain/types/query.types'
import type { ProgramDiagnostic, QueryProgramPayload } from '@/domain/types/program.types'
import type { DataViewRef } from '@/domain/types/data-view-source.types'
import type { QueryProgramProp, SourceExpressionIR } from '@/domain/types/source-expression.types'

/** Поддерживаемые kind query source v1. */
export type QuerySourceKind = 'rest'

/** Source-описание HTTP request части REST-запроса. */
export interface QuerySourceRequest {
  /** Endpoint или Endge var-token вида {API_URL}. */
  endpoint: string

  /** REST path. В legacy RQuery это поле хранится как query. */
  path: string

  /** HTTP method. */
  method: string

  /** HTTP headers. */
  headers: Record<string, string>

  /** Auth config. */
  auth: RQueryAuth

  /** Request timeout. */
  timeoutMs?: number

  /** Отправлять body как application/x-www-form-urlencoded. */
  formUrlencoded?: boolean

  /** Безопасный body expression для query source v2. */
  body?: SourceExpressionIR | null
}

/** Source-описание mock-режима запроса. */
export interface QuerySourceMock {
  /** Включены ли mock data. */
  enabled: boolean

  /** Mock payload. */
  data: unknown
}

export type QueryOutputSource
  = | {
    type: 'response'
    path: string | null
  }
  | {
    type: 'output'
    key: string
  }

export interface QuerySourceOutput {
  key: string
  source: QueryOutputSource
  dataViews: DataViewRef[]
}

export type QuerySourceOutputs = QuerySourceOutput[]

/** Canonical authoring-модель source-only Query v2. */
export interface QuerySourceDocument {
  /** Тип source query. */
  kind: QuerySourceKind

  /** Request config. */
  request: QuerySourceRequest

  /** Единственный runtime input contract Query. */
  props: QueryProgramProp[]

  /** Ordered output graph: response/output sources and transformations. */
  outputs: QuerySourceOutputs

  /** Mock config. */
  mock: QuerySourceMock
}

/** Публичные editor-slots, которые query source patcher умеет менять точечно. */
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

/** Операция AST-патчинга query source. */
export interface QuerySourcePatchOperation {
  /** Изменяемый editor-slot. */
  path: QuerySourcePatchPath

  /** Новое normalized значение, если patcher должен сам напечатать expression. */
  value?: unknown

  /** Готовое source-expression для сложных DSL-значений: env(...), field(...), filter... */
  expression?: string
}

/** Patch query source: одиночная операция или пачка операций. */
export type QuerySourcePatch = QuerySourcePatchOperation | QuerySourcePatchOperation[]

/** Результат компиляции query source. */
export interface QuerySourceCompileResult {
  /** Parser-level AST. */
  ast: unknown | null

  /** Canonical authoring-модель. */
  document: QuerySourceDocument | null

  /** Query artifact payload для Endge.program. */
  artifact: QueryProgramPayload | null

  /** Diagnostics source compiler-а. */
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
}
