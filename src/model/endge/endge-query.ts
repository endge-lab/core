import type { RQuery } from '@/domain/entities/reflect/RQuery'
import type { RQueryFilter } from '@/domain/entities/reflect/RQueryFilter'
import type { RQueryAuth } from '@/domain/types/query.types'
import type { AxiosInstance } from 'axios'

import { Raph } from '@endge/raph'
import axios from 'axios'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { Endge } from '@/model/endge/endge'
import { RQueryRest } from '@/domain/entities/reflect/RQueryRest'

export class EndgeQuery extends EndgeModule {
  constructor(
    private readonly http: AxiosInstance = axios.create({
      headers: { Accept: 'application/json' },
    }),
  ) {
    super()
  }

  /** Разрешает один элемент фильтра в объект (inline JSON или reference из Raph). space - из рантайма (meta.space). */
  private resolveFilterItem(item: RQueryFilter, space: string): Record<string, any> | null {
    if (item.mode === 'inline') {
      const json = item.inlineJson
      if (json == null)
        return null
      if (typeof json === 'object')
        return json
      if (typeof json === 'string') {
        try {
          return JSON.parse(json)
        }
        catch {
          return null
        }
      }
      return null
    }
    if (item.mode === 'reference') {
      const id = String(item.filterId ?? '').trim()
      if (!id)
        return null
      const key = id.startsWith('filters.') ? id : `filters.${id}.${space}`
      try {
        const v = Raph.get(key)
        if (!v || typeof v !== 'object')
          return null
        return v as Record<string, any>
      }
      catch {
        return null
      }
    }
    return null
  }

  /** Собирает итоговый фильтр: последовательное слияние всех элементов q.filters. space - из рантайма. */
  private buildMergedFilter(q: RQueryRest, space: string): Record<string, any> | null {
    const list = (q as any).filters
    if (!Array.isArray(list) || list.length === 0)
      return null

    let acc: Record<string, any> | null = null
    for (const item of list) {
      const next = this.resolveFilterItem(item, space)
      if (next == null)
        continue
      acc = acc == null ? next : this.deepMerge(acc, next)
    }
    return acc
  }

  private deepMerge(a: any, b: any): any {
    if (Array.isArray(a) || Array.isArray(b))
      return b
    if (typeof a !== 'object' || typeof b !== 'object')
      return b

    const out = { ...a }
    for (const key of Object.keys(b)) {
      out[key] = key in a ? this.deepMerge(a[key], b[key]) : b[key]
    }
    return out
  }

  async run(query: RQuery, params: Record<string, unknown> = {}): Promise<any> {
    let result: any

    if (query.customExecutor) {
      result = await query.customExecutor()
    }
    else if ((query as any).mockDataEnabled) {
      const raw = (query as any).mockData
      try {
        result = typeof raw === 'string' ? JSON.parse(raw) : raw
      }
      catch {
        result = raw
      }
    }
    else if (query instanceof RQueryRest) {
      result = await this.runRest(query, params)
    }
    else {
      console.warn(
        `[EndgeQuery] Unknown query type for "${query.name}" (id=${query.id}).`,
      )
      result = []
    }

    const queryIdentity = String((query as any).identity ?? '').trim()
    if (queryIdentity) {
      Raph.set(`queries.${queryIdentity}.${query.subField}`, result)
    }

    console.log(result)
    return result
  }

  /** Безопасно склеивает base и path с учётом слэшей; если path абсолютный - возвращаем его. */
  private buildUrl(base: string, path?: string | null): string {
    if (!path)
      return base
    const p = String(path)
    // Абсолютный URL - используем как есть
    if (/^(https?:)?\/\//i.test(p))
      return p
    const a = base.endsWith('/') ? base.slice(0, -1) : base
    const b = p.startsWith('/') ? p.slice(1) : p
    return `${a}/${b}`
  }

  /**
   * Исполнение REST-запроса (через общий axios из Endge.runtime.http).
   */
  private async runRest(
    q: RQueryRest,
    vars: Record<string, unknown>,
  ): Promise<any> {
    const endpoint = Endge.vars.resolve(q.endpoint) || q.endpoint
    const queryPath = Endge.vars.resolve((q as any).query)
    const url = this.buildUrl(endpoint, queryPath)

    const method = q.method.toUpperCase() as
      | 'GET'
      | 'POST'
      | 'PUT'
      | 'PATCH'
      | 'DELETE'

    const headers = { ...(q.headers || {}) } as Record<string, string>

    const filterSpace = typeof vars?.filterSpace === 'string' ? String(vars.filterSpace).trim() || 'default' : 'default'
    const baseFilter = this.buildMergedFilter(q, filterSpace)

    const requestVars = { ...(vars ?? {}) }
    delete requestVars.filterSpace

    let data: any
    let params: Record<string, any> | undefined

    if (method === 'GET' || method === 'DELETE') {
      params = baseFilter
        ? this.deepMerge(baseFilter, requestVars)
        : requestVars
    }
    else {
      const effectiveBody = baseFilter
        ? this.deepMerge(baseFilter, requestVars)
        : requestVars

      if (q.sendAsFormUrlencoded) {
        const form = new URLSearchParams()
        for (const [k, v] of Object.entries(effectiveBody)) {
          if (v === null || v === undefined)
            continue
          form.append(k, String(v))
        }
        data = form
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
      }
      else {
        data = effectiveBody
      }
    }

    await this.applyAuth(q.auth, headers, (params ??= {}))

    try {
      const res = await this.http.request({
        url,
        method,
        headers,
        params,
        data,
        timeout: q.timeoutMs,
      })
      return res.data
    }
    catch (err: any) {
      const status = err?.response?.status
      const statusText = err?.response?.statusText
      const payload = err?.response?.data

      const msg = status
        ? `HTTP ${status} ${statusText || ''} at ${url}`
        : `HTTP error at ${url}`

      const details
        = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {})

      throw new Error(`${msg}\n${details}`)
    }
  }

  private async applyAuth(
    auth: RQueryAuth | undefined,
    headers: Record<string, string>,
    qs?: Record<string, unknown>,
  ): Promise<void> {
    const a: RQueryAuth = auth ?? { mode: 'token' }

    if (a.mode === 'none') {
      const headerName: string = a.headerName ?? 'Authorization'
      delete headers[headerName]
      return
    }

    const manualRaw: string | undefined
      = Endge.vars.resolve(a.manualToken) ?? a.manualToken
    const token: string | undefined = manualRaw
      ? await Endge.auth.getAccessToken({
          mode: 'manual',
          manualToken: manualRaw,
        })
      : await Endge.auth.getAccessToken({ mode: 'inherit' })

    if (!token)
      return

    const scheme: string = a.scheme ?? 'Bearer'

    if (a.sendAs === 'query') {
      if (qs) {
        const paramName: string = a.queryParamName ?? 'access_token'
        ;(qs as Record<string, unknown>)[paramName] = token
      }
      return
    }

    const headerName: string = a.headerName ?? 'Authorization'
    headers[headerName] = `${scheme} ${token}`
  }
}
