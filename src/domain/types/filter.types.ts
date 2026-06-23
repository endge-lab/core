/** Опция статического списка поля фильтра. */
export interface FilterStaticOptionSchema {
  value: string
  label?: string
}

/** Режим поля фильтра: список (статический/словарь) или примитив. */
export type FilterFieldMode = 'static' | 'vocab' | 'date' | 'time' | 'datetime' | 'boolean' | 'string' | 'number'

/** Поле фильтра (коллекция filters в Payload). */
export interface FilterFieldItemSchema {
  key: string
  label?: string
  mode: FilterFieldMode
  staticOptions?: FilterStaticOptionSchema[]
  vocabIdentity?: string
  vocabCollection?: string
  valuePath?: string
  /** Путь до поля подписи в UI фильтра (в документе словаря). */
  displayNamePath?: string
  /** Для словаря: разрешён ли множественный выбор (по умолчанию true). */
  multiple?: boolean
  /** Цепочка конвертеров (identity из домена), применяются последовательно. */
  converterIdentities?: string[]
  defaultValue?: string
  active?: boolean
}

/** Схема фильтра (коллекция filters в Payload). */
export interface RFilterSchema {
  identity: string
  displayName: string
  fields?: FilterFieldItemSchema[]
  folder?: string | null
  /** Id папки в Payload (для relationship при сохранении). */
  folderId?: number | string | null
  author?: string | null
  active?: boolean
  deletedAt?: string | null
  meta?: Record<string, unknown>
  inherited?: boolean
}
