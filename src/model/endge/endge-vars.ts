import type { EndgeGlobalVar } from '@/domain/types/types'
import type { EndgeBootContext } from '@/domain/types/bootstrap.types'

import { Raph } from '@endge/raph'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import Config from '@/model/config'
import { Endge } from '@/model/endge/endge'

type EnvRecord = Record<string, unknown>

/**
 * EndgeVars - контроллер глобальных переменных.
 *
 * Источник списка переменных:
 *  - workspace.vars
 *  - legacy fallback: settings.general.vars
 *
 * Источники значений и приоритеты:
 *  1) ENVY/runtime vars (если задано) - самый высокий приоритет
 *  2) Vite env: import.meta.env.VITE_<NAME> (напрямую, без сканирования)
 *     - имя переменной внутри системы: без префикса (ENDPOINT_AUTH -> VITE_ENDPOINT_AUTH)
 *  3) workspace.vars
 *  4) legacy settings.general.vars
 *
 * Особенности:
 *  - сам класс НЕ хранит данные, только читает их из домена
 *  - кладёт итоговые значения в Raph.app под `${Config.STORAGE_VARS_KEY}.*`
 *  - умеет резолвить строки вида "{VAR}" (через getValue)
 */
export class EndgeVars extends EndgeModule {

  // Переопределение переменных среды
  private _envyRecord: EnvRecord = {}

  /**
   * Принимает runtime/env overrides из boot context.
   */
  public override setup(ctx: EndgeBootContext): void {
    this.setEnvyRecord(ctx.vars)
  }

  /**
   * Синхронизирует итоговые значения переменных и runtime-фильтров в Raph.
   */
  public override start(): void {
    this.syncAllToRaph()
    this.hydrateRuntimeFilters()
  }

  /**
   * Устанавливает внешние overrides переменных и сразу пересинхронизирует Raph.
   */
  setEnvyRecord(envyRecord: EnvRecord): void {
    this._envyRecord = envyRecord ?? {}
    this.syncAllToRaph()
  }

  /**
   * Внутренний helper модуля: hydrate Runtime Filters.
   */
  private hydrateRuntimeFilters(): void {
    try {
      const raw = localStorage.getItem('endge:parameters')
      if (!raw) { return }

      const store = JSON.parse(raw) as Record<string, unknown>
      if (!store || typeof store !== 'object') { return }

      for (const [identity, payload] of Object.entries(store)) {
        if (!identity) { continue }

        Raph.set(
          identity.startsWith('parameters.') ? identity : `parameters.${identity}`,
          payload,
        )
      }
    }
    catch (error) {
      console.error(error)
    }
  }

  // ========================================================================
  // DOMAIN
  // ========================================================================

  /**
   * Возвращает Domain Vars.
   */
  private getDomainVars(): EndgeGlobalVar[] {
    try {
      const workspaceVars = Endge.workspace.vars
      if (workspaceVars.length > 0) {
        return workspaceVars.map((item) => {
          const name = String(item.name ?? '').trim()
          const val = this.getExternalValue(name) ?? item.defaultValue
          return {
            name,
            defaultValue: String(item.defaultValue ?? ''),
            currentValue: String(val ?? ''),
          }
        })
      }

      const settings = Endge.domain.getSetting('general') as
        | { vars?: EndgeGlobalVar[] }
        | undefined

      const src: EndgeGlobalVar[] = settings?.vars ?? []
      const res = src.map((item: EndgeGlobalVar) => {

        let val = item.defaultValue

        val = this.getExternalValue(item.name) ?? val

        return {
          name: String(item.name ?? '').trim(),
          defaultValue: String(val ?? ''),
          currentValue: String(val),
        }
      })

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

    const external = this.getExternalValue(key)
    if (external != null)
      return String(external)

    const vars: EndgeGlobalVar[] = this.getDomainVars()
    const v: EndgeGlobalVar | undefined = vars.find((x: EndgeGlobalVar) => x.name === key)
    if (v)
      return v.currentValue ?? v.defaultValue

    return undefined
  }

  /**
   * Возвращает все доменные переменные с учетом overrides.
   */
  getAll(): EndgeGlobalVar[] {
    const vars = this.getDomainVars()
    const used = new Set(vars.map(item => item.name))
    for (const [name, value] of Object.entries(this._envyRecord)) {
      const key = String(name ?? '').trim()
      if (!key || used.has(key))
        continue
      used.add(key)
      vars.push({
        name: key,
        defaultValue: '',
        currentValue: String(value ?? ''),
      })
    }
    return vars
  }

  /**
   * Возвращает переменные в виде record, удобном для сериализации и debug UI.
   */
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

  /**
   * Резолвит строку вида `{VAR}` в значение переменной и применяет optional coercion.
   */
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

  /**
   * Приводит значение переменной к number.
   */
  static toNumber(v: unknown): number {
    if (typeof v === 'number')
      return v
    if (v == null)
      return Number.NaN
    return Number(String(v).trim())
  }

  /**
   * Приводит значение переменной к string.
   */
  static toString(v: unknown): string {
    return v == null ? '' : String(v)
  }

  /**
   * Приводит значение переменной к boolean.
   */
  static toBoolean(v: unknown): boolean {
    if (typeof v === 'boolean')
      return v
    const s: string = String(v).trim().toLowerCase()
    return s === 'true' || s === '1'
  }

  /**
   * Внутренний helper модуля: parse Var Token.
   */
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

  /**
   * Внутренний helper модуля: sync All To Raph.
   */
  private syncAllToRaph(): void {
    const vars: EndgeGlobalVar[] = this.getAll()
    for (const v of vars) {
      if (!v.name)
        continue

      this.syncOneToRaph(v.name, this.getValue(v.name))
    }
  }

  /**
   * Внутренний helper модуля: sync One To Raph.
   */
  private syncOneToRaph(name: string, value: string | undefined): void {
    Raph.app.set(`${Config.STORAGE_VARS_KEY}.${name}`, value)
  }

  private getExternalValue(name: string): unknown {
    const key = String(name ?? '').trim()
    if (!key)
      return undefined
    if (Object.prototype.hasOwnProperty.call(this._envyRecord, key))
      return this._envyRecord[key]

    const viteEnv = (import.meta as any)?.env
    const viteKey = `VITE_${key}`
    if (viteEnv && Object.prototype.hasOwnProperty.call(viteEnv, viteKey))
      return viteEnv[viteKey]

    const globalEnv = (globalThis as any).__ENDGE_ENV__
    if (globalEnv && Object.prototype.hasOwnProperty.call(globalEnv, key))
      return globalEnv[key]

    return undefined
  }
}
