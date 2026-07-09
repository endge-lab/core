export type I18nLocaleMessages = Record<string, unknown>

export type I18nLocales = Record<string, I18nLocaleMessages>

export interface I18nTranslateOptions {
  locale?: string
  fallbackLocale?: string
  bundle?: string
  params?: Record<string, unknown>
  defaultValue?: string
}

export interface I18nMessagesOptions {
  bundle?: string
  includeInactive?: boolean
}
