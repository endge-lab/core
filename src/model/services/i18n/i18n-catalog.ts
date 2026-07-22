import type {
  I18nCompiledLocales,
  I18nLocaleMessages,
  I18nLocales,
  I18nRuntimeCatalog,
} from '@/domain/types/i18n.types'
import type { CompositionI18nResourceArtifact } from '@/domain/types/source/composition-source.types'

/** Материализует authored locale trees в плоские dot-path индексы. */
export function compileI18nLocales(locales: I18nLocales): I18nCompiledLocales {
  return Object.fromEntries(
    Object.entries(locales).map(([locale, messages]) => {
      const target: Record<string, string> = {}
      if (isPlainObject(messages))
        writeMessages(target, messages as I18nLocaleMessages)
      return [locale, target]
    }),
  )
}

/** Возвращает все логические message keys независимо от локали. */
export function collectI18nMessageKeys(messages: I18nCompiledLocales): Set<string> {
  return new Set(Object.values(messages).flatMap(locale => Object.keys(locale)))
}

/** Добавляет локальные ресурсы scope к унаследованному runtime catalog. */
export function extendI18nRuntimeCatalog(
  inherited: I18nRuntimeCatalog,
  resources: readonly CompositionI18nResourceArtifact[],
): I18nRuntimeCatalog {
  const catalog = cloneI18nRuntimeCatalog(inherited)
  for (const resource of resources) {
    const entry = catalog[resource.name] ?? {
      messages: {},
    }
    const messages = Object.fromEntries(
      Object.entries(entry.messages).map(([locale, values]) => [locale, { ...values }]),
    )
    for (const [locale, values] of Object.entries(resource.messages))
      messages[locale] = { ...(messages[locale] ?? {}), ...values }
    catalog[resource.name] = { messages }
  }
  return catalog
}

/** Создаёт независимый snapshot runtime catalog для передачи дочернему host. */
export function cloneI18nRuntimeCatalog(catalog: I18nRuntimeCatalog): I18nRuntimeCatalog {
  return Object.fromEntries(
    Object.entries(catalog).map(([name, entry]) => [name, {
      messages: Object.fromEntries(
        Object.entries(entry.messages).map(([locale, values]) => [locale, { ...values }]),
      ),
    }]),
  )
}

function writeMessages(target: Record<string, string>, source: I18nLocaleMessages, prefix = ''): void {
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (!path)
      continue
    if (isPlainObject(value)) {
      writeMessages(target, value as I18nLocaleMessages, path)
      continue
    }
    if (value != null)
      target[path] = typeof value === 'string' ? value : String(value)
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
