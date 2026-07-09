import type { RI18nBundle } from '@/domain/entities/reflect/RI18nBundle'
import type { I18nLocaleMessages, I18nMessagesOptions, I18nTranslateOptions } from '@/domain/types/i18n.types'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { Endge } from '@/model/endge/endge'

/**
 * Runtime-доступ к доменным словарям переводов.
 */
export class EndgeI18n extends EndgeModule {
  private _fallbackLocale = 'en'
  private _offContext: (() => void) | null = null
  private _offDomain: (() => void) | null = null
  private readonly _messagesByLocale = new Map<string, Map<string, string>>()
  private readonly _messagesByBundle = new Map<string, Map<string, Map<string, string>>>()

  /**
   * Подписывается на контекст, чтобы подписчики i18n тоже реагировали на смену locale.
   */
  public override setup(): void {
    this._offContext?.()
    this._offDomain?.()
    this._offContext = Endge.context.subscribe(() => this.notify())
    this._offDomain = Endge.domain.subscribe(() => this.rebuildIndexes())
  }

  /**
   * Компилирует активные i18n-bundles в плоские индексы для O(1) lookup.
   */
  public override build(): void {
    this.rebuildIndexes()
  }

  /**
   * Очищает подписку на контекст.
   */
  public override reset(): void {
    this._offContext?.()
    this._offDomain?.()
    this._offContext = null
    this._offDomain = null
    this._messagesByLocale.clear()
    this._messagesByBundle.clear()
  }

  /**
   * Текущая локаль переводов.
   */
  public get locale(): string {
    return Endge.context.currentLocale
  }

  /**
   * Локаль fallback, если ключ отсутствует в текущей локали.
   */
  public get fallbackLocale(): string {
    return this._fallbackLocale
  }

  /**
   * Задает текущую локаль.
   */
  public setLocale(locale: string): void {
    Endge.context.setCurrentLocale(locale)
  }

  /**
   * Задает fallback-локаль.
   */
  public setFallbackLocale(locale: string): void {
    const next = String(locale ?? '').trim()
    if (!next || next === this._fallbackLocale)
      return

    this._fallbackLocale = next
    this.notify()
  }

  /**
   * Пересобирает индексы переводов из активных i18n-bundles.
   */
  public rebuildIndexes(): void {
    this._messagesByLocale.clear()
    this._messagesByBundle.clear()

    for (const bundle of this._getBundles(false)) {
      const bundleIdentity = String(bundle.identity ?? '').trim()
      if (!bundleIdentity)
        continue

      const locales = bundle.locales ?? {}
      for (const [locale, messages] of Object.entries(locales)) {
        if (!this._isPlainObject(messages))
          continue

        this._writeMessagesIndex(
          this._getLocaleIndex(locale),
          messages as I18nLocaleMessages,
        )
        this._writeMessagesIndex(
          this._getBundleLocaleIndex(bundleIdentity, locale),
          messages as I18nLocaleMessages,
        )
      }
    }

    this.notify()
  }

  /**
   * Переводит ключ из активных i18n-bundles.
   */
  public t(key: string, options: I18nTranslateOptions | string = {}): string {
    const normalized = this._normalizeOptions(options)
    const value = this.resolve(key, normalized)

    if (value == null)
      return normalized.defaultValue ?? key

    const text = typeof value === 'string' ? value : String(value)
    return this._interpolate(text, normalized.params)
  }

  /**
   * Проверяет, существует ли перевод для ключа.
   */
  public te(key: string, options: I18nTranslateOptions | string = {}): boolean {
    return this.resolve(key, this._normalizeOptions(options)) != null
  }

  /**
   * Возвращает значение перевода без приведения к строке.
   */
  public resolve(key: string, options: I18nTranslateOptions | string = {}): unknown {
    const normalized = this._normalizeOptions(options)
    const parsed = this._parseKey(key, normalized.bundle)
    const locale = normalized.locale ?? this.locale
    const fallbackLocale = normalized.fallbackLocale ?? this._fallbackLocale

    return this._resolveFromIndex(parsed.key, locale, parsed.bundle)
      ?? this._resolveFromIndex(parsed.key, fallbackLocale, parsed.bundle)
  }

  /**
   * Собирает сообщения активных словарей для указанной локали.
   */
  public getMessages(locale = this.locale, options: I18nMessagesOptions = {}): I18nLocaleMessages {
    const out: I18nLocaleMessages = {}

    for (const bundle of this._getBundles(options.includeInactive === true)) {
      if (options.bundle && bundle.identity !== options.bundle)
        continue

      const messages = this._readLocaleMessages(bundle, locale)
      this._mergeMessages(out, messages)
    }

    return out
  }

  private _normalizeOptions(options: I18nTranslateOptions | string): I18nTranslateOptions {
    return typeof options === 'string' ? { locale: options } : options
  }

  private _parseKey(key: string, bundle?: string): { bundle?: string, key: string } {
    const rawKey = String(key ?? '').trim()
    const separatorIndex = rawKey.indexOf(':')

    if (bundle || separatorIndex < 1) {
      return {
        bundle,
        key: rawKey,
      }
    }

    return {
      bundle: rawKey.slice(0, separatorIndex),
      key: rawKey.slice(separatorIndex + 1),
    }
  }

  private _resolveFromIndex(key: string, locale: string, bundleIdentity?: string): string | undefined {
    if (!key || !locale)
      return undefined

    if (bundleIdentity)
      return this._messagesByBundle.get(bundleIdentity)?.get(locale)?.get(key)

    return this._messagesByLocale.get(locale)?.get(key)
  }

  private _getBundles(includeInactive: boolean): RI18nBundle[] {
    return Endge.domain.getI18nBundles().filter(bundle => includeInactive || bundle.active !== false)
  }

  private _readLocaleMessages(bundle: RI18nBundle, locale: string): I18nLocaleMessages {
    const locales = bundle.locales ?? {}
    const messages = locales[locale]
    return messages && typeof messages === 'object' && !Array.isArray(messages) ? messages : {}
  }

  private _interpolate(text: string, params?: Record<string, unknown>): string {
    if (!params)
      return text

    return text.replace(/\{([^{}]+)\}/g, (match, key: string) => {
      const value = params[key]
      return value == null ? match : String(value)
    })
  }

  private _mergeMessages(target: I18nLocaleMessages, source: I18nLocaleMessages): void {
    for (const [key, value] of Object.entries(source)) {
      const prev = target[key]
      if (
        prev
        && typeof prev === 'object'
        && !Array.isArray(prev)
        && value
        && typeof value === 'object'
        && !Array.isArray(value)
      ) {
        this._mergeMessages(prev as I18nLocaleMessages, value as I18nLocaleMessages)
        continue
      }

      target[key] = value
    }
  }

  private _getLocaleIndex(locale: string): Map<string, string> {
    const key = String(locale ?? '').trim()
    let index = this._messagesByLocale.get(key)
    if (!index) {
      index = new Map<string, string>()
      this._messagesByLocale.set(key, index)
    }
    return index
  }

  private _getBundleLocaleIndex(bundleIdentity: string, locale: string): Map<string, string> {
    let bundleIndex = this._messagesByBundle.get(bundleIdentity)
    if (!bundleIndex) {
      bundleIndex = new Map<string, Map<string, string>>()
      this._messagesByBundle.set(bundleIdentity, bundleIndex)
    }

    const localeKey = String(locale ?? '').trim()
    let localeIndex = bundleIndex.get(localeKey)
    if (!localeIndex) {
      localeIndex = new Map<string, string>()
      bundleIndex.set(localeKey, localeIndex)
    }

    return localeIndex
  }

  private _writeMessagesIndex(
    target: Map<string, string>,
    source: I18nLocaleMessages,
    prefix = '',
  ): void {
    for (const [key, value] of Object.entries(source)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (!path)
        continue

      if (this._isPlainObject(value)) {
        this._writeMessagesIndex(target, value as I18nLocaleMessages, path)
        continue
      }

      if (value != null)
        target.set(path, typeof value === 'string' ? value : String(value))
    }
  }

  private _isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
  }
}
