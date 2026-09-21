import type { I18nRuntimeCatalog } from '@/features/core/modules/i18n/domain/i18n.types'

/** Одно разрешение translation catalog для живого и наблюдаемого renderer. */
export function resolveRuntimeTranslation(catalog: I18nRuntimeCatalog, key: string, locale: string, fallbackLocale: string, fallback?: string): string {
  const rawKey = String(key ?? '').trim()
  const separator = rawKey.indexOf(':')
  if (separator > 0) {
    const entry = catalog[rawKey.slice(0, separator)]
    const messageKey = rawKey.slice(separator + 1)
    const value = entry?.messages[locale]?.[messageKey] ?? entry?.messages[fallbackLocale]?.[messageKey]
    if (value != null) {
      return value
    }
  }
  return fallback ?? `{{${rawKey}}}`
}
