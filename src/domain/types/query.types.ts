import { Expose } from 'class-transformer'

export type RQueryAuthMode = 'none' | 'token' | 'inherit' | 'profile' | 'manual'

export interface RQueryAuth {
  mode: RQueryAuthMode
  authProfileIdentity?: string

  /**
   * Необязательный ручной токен. Если НЕ задан, будет взят из Endge.auth.
   * Пример: "eyJhbGciOi..."
   */
  manualToken?: string

  /** Схема для заголовка (по умолчанию "Bearer"). */
  scheme?: string

  /** Имя заголовка (по умолчанию "Authorization"). */
  headerName?: string

  /**
   * Куда класть токен: в заголовок или в query.
   * По умолчанию 'header'.
   */
  sendAs?: 'header' | 'query'

  /** Имя query-параметра (если sendAs='query', по умолчанию 'access_token'). */
  queryParamName?: string
}

/** Режим применения списка фильтров запроса (пока только слияние по порядку). */
export type RQueryFilterApplyMode = 'merge'

export type FilterFieldType
  = | 'string'
    | 'number'
    | 'boolean'
    | 'date'
    | 'datetime'
    | 'select'
    | 'multi-select'

export interface FilterStaticValue {
  label: string
  value: string
}

export interface FilterDynamicSource {
  type: 'payload' | 'vocabs' | 'query'
  collection?: string
  mapLabel?: string
  mapValue?: string
  queryIdentity?: string
}

export interface FilterFieldSchema {
  key: string
  label: string
  description?: string
  required?: boolean
  multiple?: boolean
  type: FilterFieldType
  staticValues?: FilterStaticValue[]
  dynamicSource?: FilterDynamicSource | null
}

export interface RuntimeFilterLink {
  identity: string
  displayName: string
  description?: string
}

/** Схема параметра (коллекция parameters в Payload). */
export interface RParameterSchema {
  identity: string
  displayName: string
  description?: string
  fields: FilterFieldSchema[]
  runtimeFilters?: RuntimeFilterLink[]
  folder?: string | null
  author?: string
  active: boolean
  deletedAt?: string | null
}

export class RuntimeFilterLinkEntity {
  @Expose() identity: string = ''
  @Expose() displayName: string = ''
  @Expose() description?: string
}
