export type I18nLocaleMessages = Record<string, unknown>

export type I18nLocales = Record<string, I18nLocaleMessages>

/** Плоский compiler-derived индекс сообщений одной локали. */
export type I18nCompiledLocaleMessages = Record<string, string>

/** Compiler-derived сообщения одного i18n-документа по локалям. */
export type I18nCompiledLocales = Record<string, I18nCompiledLocaleMessages>

/** Один публичный translation alias в runtime-контексте Composition. */
export interface I18nRuntimeCatalogEntry {
  messages: I18nCompiledLocales
}

/** Накопленный translation catalog, доступный дочернему runtime. */
export type I18nRuntimeCatalog = Record<string, I18nRuntimeCatalogEntry>

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
