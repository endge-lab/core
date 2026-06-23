import type { EndgeGlobalVar } from '@/domain/types/types'

import { Raph } from '@endge/raph'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import Config from '@/model/config'
import { Endge } from '@/model/endge/endge'

type EnvRecord = Record<string, unknown>

/**
 * EndgeVars - контроллер глобальных переменных.
 *
 * Источник списка переменных:
 *  - settings.general.vars в домене (Endge.domain.getSetting('general'))
 *
 * Источники значений и приоритеты:
 *  1) ENVY (если задано) - самый высокий приоритет
 *  2) Vite env: import.meta.env.VITE_<NAME> (напрямую, без сканирования)
 *     - имя переменной внутри системы: без префикса (ENDPOINT_AUTH -> VITE_ENDPOINT_AUTH)
 *  3) settings.general.vars (домен)
 *
 * Особенности:
 *  - сам класс НЕ хранит данные, только читает их из домена
 *  - кладёт итоговые значения в Raph.app под `${Config.STORAGE_VARS_KEY}.*`
 *  - умеет резолвить строки вида "{VAR}" (через getValue)
 */
export class EndgeVars extends EndgeModule {

  // Переопределение переменных среды
  private _envyRecord: EnvRecord = {}

  init(): void {
    this.syncAllToRaph()
  }

  setEnvyRecord(envyRecord: EnvRecord): void {
    this._envyRecord = envyRecord ?? {}
    this.syncAllToRaph()
  }

  // ========================================================================
  // DOMAIN
  // ========================================================================

  private getDomainVars(): EndgeGlobalVar[] {
    try {
      const settings = Endge.domain.getSetting('general') as
        | { vars?: EndgeGlobalVar[] }
        | undefined

      const src: EndgeGlobalVar[] = settings?.vars ?? []
      const res = src.map((item: EndgeGlobalVar) => {

        let val = item.defaultValue

        if (this._envyRecord[item.name]) {
          val = this._envyRecord[item.name]
        }

        return {
          name: String(item.name ?? '').trim(),
          defaultValue: String(val ?? ''),
          currentValue: String(val),
        }
      })

      console.log( 'getDomainVars', res)
      return res
    }
    catch (e) {
      console.warn('[EndgeVars] Failed to read vars from domain settings', e)
      return []
    }
  }

  // ========================================================================
  // PUBLIC API
  // ========================================================================

  /**
   * Порядок поиска:
   *  1) ENVY
   *  2) Vite env: import.meta.env.VITE_<NAME>
   *  3) домен
   */
  getValue(name: string): string | undefined {
    const key: string = name?.trim()
    if (!key)
      return undefined

    const vars: EndgeGlobalVar[] = this.getDomainVars()
    const v: EndgeGlobalVar | undefined = vars.find((x: EndgeGlobalVar) => x.name === key)
    if (v)
      return v.currentValue ?? v.defaultValue

    return undefined
  }

  getAll(): EndgeGlobalVar[] {
    return this.getDomainVars()
  }

  toRecord(): Record<string, { defaultValue: string, currentValue: string }> {
    const out: Record<string, { defaultValue: string, currentValue: string }> = {}
    for (const v of this.getDomainVars()) {
      if (!v.name)
        continue
      out[v.name] = {
        defaultValue: v.defaultValue,
        currentValue: v.currentValue ?? v.defaultValue,
      }
    }
    return out
  }

  resolve<T = string>(
    raw: unknown,
    options?: {
      coerce?: (value: string | number | boolean | null | undefined) => T
      fallback?: T
      onInvalid?: 'fallback' | 'as-is' | 'throw'
    },
  ): T | undefined {
    const {
      coerce = (v: string | number | boolean | null | undefined) => v as unknown as T,
      fallback,
      onInvalid = 'fallback',
    } = options ?? {}

    if (typeof raw !== 'string') {
      return coerce(raw as any)
    }

    const trimmed: string = raw.trim()
    const parsed = EndgeVars.parseVarToken(trimmed)

    if (parsed.ok) {
      const val: string | undefined = this.getValue(parsed.name)
      return val == null ? fallback : coerce(val)
    }

    if (parsed.reason === 'not-a-braced-endgeToken') {
      return coerce(trimmed)
    }

    switch (onInvalid) {
      case 'as-is':
        return coerce(trimmed)
      case 'throw':
        throw new Error(
          `[EndgeVars.resolve] invalid variable token "${trimmed}": ${parsed.reason}`,
        )
      case 'fallback':
      default:
        return fallback
    }
  }

  static toNumber(v: unknown): number {
    if (typeof v === 'number')
      return v
    if (v == null)
      return Number.NaN
    return Number(String(v).trim())
  }

  static toString(v: unknown): string {
    return v == null ? '' : String(v)
  }

  static toBoolean(v: unknown): boolean {
    if (typeof v === 'boolean')
      return v
    const s: string = String(v).trim().toLowerCase()
    return s === 'true' || s === '1'
  }

  private static parseVarToken(
    token: string,
  ): { ok: true, name: string } | { ok: false, reason: string } {
    const s: string = token.trim()
    if (s.length < 2 || s[0] !== '{' || s[s.length - 1] !== '}') {
      return { ok: false, reason: 'not-a-braced-endgeToken' }
    }

    let inner: string = s.slice(1, -1).trim()
    if (!inner)
      return { ok: false, reason: 'empty' }
    if (inner.includes('{') || inner.includes('}')) {
      return { ok: false, reason: 'nested-braces' }
    }

    if (
      (inner.startsWith('"') && inner.endsWith('"'))
      || (inner.startsWith('\'') && inner.endsWith('\''))
    ) {
      inner = inner.slice(1, -1).trim()
      if (!inner)
        return { ok: false, reason: 'empty-quoted' }
    }

    const NAME_RE: RegExp = /^[A-Z_][\w.-]*$/i
    if (!NAME_RE.test(inner)) {
      return { ok: false, reason: 'invalid-name' }
    }

    return { ok: true, name: inner }
  }

  // ========================================================================
  // Raph sync
  // ========================================================================

  private syncAllToRaph(): void {
    const vars: EndgeGlobalVar[] = this.getDomainVars()
    for (const v of vars) {
      if (!v.name)
        continue

      this.syncOneToRaph(v.name, this.getValue(v.name))
    }
  }

  private syncOneToRaph(name: string, value: string | undefined): void {
    Raph.app.set(`${Config.STORAGE_VARS_KEY}.${name}`, value)
  }
}
