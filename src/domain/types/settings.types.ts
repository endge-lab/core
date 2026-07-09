/** Откуда брать значение переменной */
export type SettingsVarSecretSource = 'pure' | 'secret'

export interface SettingsVarSchema {
  /** Имя переменной (ключ). Уникален в рамках settings.vars */
  name: string
  /** Значение по умолчанию */
  defaultValue: string
  /** Текущее значение (может быть пустым => брать defaultValue) */
  currentValue?: string
  /** Источник (как в Payload-схеме) */
  secret?: SettingsVarSecretSource
}

/** Провайдер авторизации */
export type SettingsAuthProvider = 'keycloak_manual' | 'keycloak_form'

export type StringRecord = Record<string, string>

export interface SettingsAuthKeycloakBase {
  provider: SettingsAuthProvider

  KeycloakBaseUrl: string
  storageKey: string

  clientId: string
  scope: string
  refreshSkewMs: number

  tokenPath?: string
  logoutPath?: string
}

export interface SettingsAuthKeycloakManualConfig extends SettingsAuthKeycloakBase {
  provider: 'keycloak_manual'
  login?: string
  password?: string
}

export interface SettingsAuthKeycloakFormConfig extends SettingsAuthKeycloakBase {
  provider: 'keycloak_form'
  // логин/пароль приходят извне через UI
}

export type SettingsAuthSchema =
  | SettingsAuthKeycloakManualConfig
  | SettingsAuthKeycloakFormConfig

//  VOCABS

export interface SettingsVocabCollectionSchema {
  /** slug коллекции во внешнем репозитории */
  name: string
}

export interface SettingsVocabSourceSchema {
  /** Идентификатор набора словарей */
  identity: string
  /** Base URL до внешнего Payload API */
  baseApiUrl: string
  /** Коллекции, которые считаем словарями */
  collections: SettingsVocabCollectionSchema[]
}

//  CUSTOM SECTIONS

export type SettingsCustomFieldType = 'string' | 'boolean' | 'select'

export interface SettingsCustomFieldSchema {
  /** Ключ поля (используется в рантайме) */
  key: string
  label: string
  type: SettingsCustomFieldType
  required?: boolean

  /** Опции для select - формат не жёстко типизируем, оставим any */
  options?: any

  /** Дефолты (динамично по type) */
  defaultString?: string
  defaultBoolean?: boolean
}

export interface SettingsCustomSectionSchema {
  /** Уникальный ключ секции, типа "ui.colors" */
  key: string
  label: string
  description?: string
  fields: SettingsCustomFieldSchema[]
}

/**
 * Основная схема настроек, которая будет храниться в EndgeSchemaDump.settings[]
 *
 * ВАЖНО: это "schema-часть", без storage-мета. Метаданные (createdAt и т.п.)
 * живут в REntity и приходят при необходимости из payload-документа.
 */
export interface SettingsSchema {
  /** id сущности в domain-смысле (identity/id) */
  id: string

  /** identity документа настроек (из поля identity в Payload) */
  identity: string

  /** Человекочитаемое имя (унифицированное) */
  name: string

  /** Название настроек (displayName) */
  displayName: string

  /** identity проекта, если настройки проектные; null/undefined - глобальные */
  project?: string | null

  /** soft-delete отметка, если документ удалён */
  deletedAt?: string | null

  /** Секция глобальных переменных */
  vars?: SettingsVarSchema[]

  /** Секция авторизации */
  auth?: SettingsAuthSchema

  /** Внешние словари (vocabs) */
  vocabs?: SettingsVocabSourceSchema[]

  /** Пользовательские секции */
  customSections?: SettingsCustomSectionSchema[]
}

export interface SettingsUpdateFieldSchema {
  /**
   * Типы обновлений через запятую, как хранится в Payload.
   * На этапе нормализации можно превратить в string[].
   */
  types: string

  /** JSON схема применения обновления */
  jsonSchema?: unknown
}

export interface SettingsUpdateProfileSchema {
  /** identity профиля обновлений */
  identity: string

  /** путь к типу события в сообщении (пример: "eventInfo.name") */
  updateTypePath: string

  /** обработчики типов сообщений */
  fields: SettingsUpdateFieldSchema[]
}

export type SettingsSSEAuthMode = 'inherit' | 'profile' | 'none' | 'manual'

export interface SettingsSSESchema {
  url: string
  authMode?: SettingsSSEAuthMode
  authProfileIdentity?: string
  manualToken?: string
}
