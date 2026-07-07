import type { RQueryAuth, RQueryFilterApplyMode } from '@/domain/types/query.types'
import type { ProgramDiagnostic, QueryProgramPayload } from '@/domain/types/program.types'

/** Поддерживаемые kind query source v1. */
export type QuerySourceKind = 'rest'

/** Описание поля в query source без привязки к class-transformer/RField. */
export interface QuerySourceField {
  /** Доменный тип поля. */
  type: string

  /** Признак массива. */
  isArray?: boolean

  /** Признак optional-поля. */
  optional?: boolean

  /** Параметры метода/объектного поля, если они есть. */
  params?: Record<string, QuerySourceField>
}

/** Source-описание одного query filter item. */
export type QuerySourceFilterItem
  = | {
    mode: 'reference'
    filterId: string
  }
  | {
    mode: 'inline'
    value: Record<string, unknown>
  }

/** Source-описание фильтров запроса. */
export interface QuerySourceFilters {
  /** Режим применения фильтров. */
  mode: RQueryFilterApplyMode

  /** Ordered list фильтров. */
  items: QuerySourceFilterItem[]
}

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
}

/** Source-описание response части запроса. */
export interface QuerySourceResponse {
  /** Подполе результата, которое считается основным payload. */
  subField: string

  /** Описание возвращаемого поля. */
  return: QuerySourceField | null
}

/** Source-описание mock-режима запроса. */
export interface QuerySourceMock {
  /** Включены ли mock data. */
  enabled: boolean

  /** Mock payload. */
  data: unknown
}

/** Canonical authoring-модель query source v1. */
export interface QuerySourceDocument {
  /** Тип source query. */
  kind: QuerySourceKind

  /** Request config. */
  request: QuerySourceRequest

  /** Параметры запроса. */
  params: Record<string, QuerySourceField>

  /** Фильтры запроса. */
  filters: QuerySourceFilters

  /** Response config. */
  response: QuerySourceResponse

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
    | 'response.subField'
    | 'response.return'
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

/** Результат генерации query source из legacy RQuery. */
export interface QuerySourceGenerateResult {
  /** Сгенерированный source. */
  source: string

  /** Canonical authoring-модель, из которой напечатан source. */
  document: QuerySourceDocument
}

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
