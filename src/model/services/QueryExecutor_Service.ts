import type { RQuery } from '@/domain/entities/reflect/RQuery'
import type { ProgramArtifact, QueryProgramFilterItem, QueryProgramOutput, QueryProgramPayload } from '@/domain/types/program.types'
import type { RQueryAuth } from '@/domain/types/query.types'
import type { AxiosInstance } from 'axios'

import { Raph } from '@endge/raph'
import axios from 'axios'

import { Endge } from '@/model/endge/endge'

export interface QueryExecutionContext {
  /** Доменный query, которому принадлежит artifact. */
  query: RQuery

  /** Runtime-ready query payload из Endge.program. */
  payload: QueryProgramPayload

  /** Локальные artifacts, принадлежащие query artifact. */
  children?: ProgramArtifact[]

  /** Входные параметры одноразового или реактивного запуска. */
  vars?: Record<string, unknown>
}

/** Выполняет compiled query artifact без чтения legacy-полей RQuery. */
export class QueryExecutor_Service {
  public constructor(
    private readonly http: AxiosInstance = axios.create({
      headers: { Accept: 'application/json' },
    }),
  ) {}

  /** Выполняет query artifact и вычисляет output graph. */
  public async execute(context: QueryExecutionContext): Promise<any> {
    const result = context.payload.mockDataEnabled
      ? this._readMockData(context.payload.mockData)
      : await this._executeByProtocol(context.payload, context.vars ?? {})

    if (!context.payload.outputs.length)
      return result

    return this._resolveOutputs(result, context)
  }

  /** Вычисляет output graph строго в порядке source document. */
  private _resolveOutputs(
    response: unknown,
    context: QueryExecutionContext,
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {}

    for (const output of context.payload.outputs) {
      let value = this._readOutputSource(output, response, values)
      for (const dataViewRef of output.dataViews)
        value = Endge.dataView.runRef(dataViewRef, value, undefined, { children: context.children ?? [] })

      values[output.key] = value
      if (output.store)
        Raph.set(this._resolveStoreKey(output, context.query), value)
    }

    return values
  }

  /** Читает source output из backend response или предыдущего output. */
  private _readOutputSource(
    output: QueryProgramOutput,
    response: unknown,
    values: Record<string, unknown>,
  ): unknown {
    if (output.source.type === 'response')
      return output.source.path == null ? response : this._path(response, output.source.path)

    if (!(output.source.key in values))
      throw new Error(`Query output "${output.key}" references missing output "${output.source.key}".`)

    return values[output.source.key]
  }

  /** Возвращает default/custom store key для output. */
  private _resolveStoreKey(output: QueryProgramOutput, query: RQuery): string {
    if (output.store?.mode === 'custom' && output.store.key)
      return output.store.key

    const queryIdentity = String(query.identity ?? query.id ?? '').trim()
    if (!queryIdentity)
      throw new Error(`Query output "${output.key}" cannot be stored without query identity.`)

    return `queries.${queryIdentity}.${output.key}`
  }

  /** Выбирает protocol executor по compiled artifact type. */
  private async _executeByProtocol(
    payload: QueryProgramPayload,
    vars: Record<string, unknown>,
  ): Promise<any> {
    if (payload.type === 'query-rest')
      return this._runRest(payload, vars)

    throw new Error(`Unsupported query artifact type: ${payload.type}`)
  }

  /** Выполняет REST artifact. */
  private async _runRest(
    payload: QueryProgramPayload,
    vars: Record<string, unknown>,
  ): Promise<any> {
    const endpoint = Endge.vars.resolve(payload.endpoint) || payload.endpoint
    const queryPath = Endge.vars.resolve(payload.query) || payload.query
    const url = this._buildUrl(endpoint, queryPath)
    const method = String(payload.method ?? 'POST').toUpperCase() as
      | 'GET'
      | 'POST'
      | 'PUT'
      | 'PATCH'
      | 'DELETE'
    const headers = { ...(payload.headers ?? {}) }

    const filterSpace = typeof vars.filterSpace === 'string'
      ? String(vars.filterSpace).trim() || 'default'
      : 'default'
    const baseFilter = this._buildMergedFilter(payload.filters, filterSpace)

    const requestVars = { ...(vars ?? {}) }
    delete requestVars.filterSpace

    let data: any
    let params: Record<string, any> | undefined

    if (method === 'GET' || method === 'DELETE') {
      params = baseFilter
        ? this._deepMerge(baseFilter, requestVars)
        : requestVars
    }
    else {
      const effectiveBody = baseFilter
        ? this._deepMerge(baseFilter, requestVars)
        : requestVars

      if (payload.sendAsFormUrlencoded) {
        const form = new URLSearchParams()
        for (const [key, value] of Object.entries(effectiveBody)) {
          if (value === null || value === undefined)
            continue
          form.append(key, String(value))
        }
        data = form
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
      }
      else {
        data = effectiveBody
      }
    }

    await this._applyAuth(payload.auth as RQueryAuth | undefined, headers, (params ??= {}))

    try {
      const response = await this.http.request({
        url,
        method,
        headers,
        params,
        data,
        timeout: payload.timeoutMs,
      })
      return response.data
    }
    catch (error: any) {
      const status = error?.response?.status
      const statusText = error?.response?.statusText
      const responsePayload = error?.response?.data
      const message = status
        ? `HTTP ${status} ${statusText || ''} at ${url}`
        : `HTTP error at ${url}`
      const details = typeof responsePayload === 'string'
        ? responsePayload
        : JSON.stringify(responsePayload ?? {})

      throw new Error(`${message}\n${details}`)
    }
  }

  /** Читает mock payload из artifact. */
  private _readMockData(raw: unknown): any {
    if (typeof raw !== 'string')
      return raw

    try {
      return JSON.parse(raw)
    }
    catch {
      return raw
    }
  }

  /** Читает dot-path из backend response без исключений. */
  private _path(source: unknown, path: string): unknown {
    const parts = String(path ?? '').split('.').filter(Boolean)
    let current: any = source
    for (const part of parts) {
      if (current == null)
        return undefined
      current = current[part]
    }
    return current
  }

  /** Разрешает один filter item в object payload. */
  private _resolveFilterItem(
    item: QueryProgramFilterItem,
    space: string,
  ): Record<string, any> | null {
    if (item.mode === 'inline') {
      if (!item.inlineJson)
        return null

      try {
        const value = JSON.parse(item.inlineJson)
        return value && typeof value === 'object' && !Array.isArray(value)
          ? value
          : null
      }
      catch {
        return null
      }
    }

    const id = String(item.filterId ?? '').trim()
    if (!id)
      return null

    const key = id.startsWith('filters.') ? id : `filters.${id}.${space}`
    try {
      const value = Raph.get(key)
      return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, any>
        : null
    }
    catch {
      return null
    }
  }

  /** Собирает merged filter из artifact filters. */
  private _buildMergedFilter(
    filters: QueryProgramFilterItem[] | undefined,
    space: string,
  ): Record<string, any> | null {
    if (!Array.isArray(filters) || filters.length === 0)
      return null

    let out: Record<string, any> | null = null
    for (const item of filters) {
      const next = this._resolveFilterItem(item, space)
      if (!next)
        continue
      out = out == null ? next : this._deepMerge(out, next)
    }
    return out
  }

  /** Deep merge для filters и runtime vars. */
  private _deepMerge(a: any, b: any): any {
    if (a == null || b == null)
      return b
    if (Array.isArray(a) || Array.isArray(b))
      return b
    if (typeof a !== 'object' || typeof b !== 'object')
      return b

    const out = { ...a }
    for (const key of Object.keys(b))
      out[key] = key in a ? this._deepMerge(a[key], b[key]) : b[key]

    return out
  }

  /** Безопасно склеивает endpoint и path. */
  private _buildUrl(base: string, path?: string | null): string {
    if (!path)
      return base

    const value = String(path)
    if (/^(https?:)?\/\//i.test(value))
      return value

    const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base
    const normalizedPath = value.startsWith('/') ? value.slice(1) : value
    return `${normalizedBase}/${normalizedPath}`
  }

  /** Применяет auth к headers или query params. */
  private async _applyAuth(
    auth: RQueryAuth | undefined,
    headers: Record<string, string>,
    qs?: Record<string, unknown>,
  ): Promise<void> {
    const current: RQueryAuth = auth ?? { mode: 'inherit' }

    if (current.mode === 'none') {
      const headerName = current.headerName ?? 'Authorization'
      delete headers[headerName]
      return
    }

    const session = await Endge.authProfiles.resolveRequestAuth(current)
    const token = session.accessToken

    if (!token)
      return

    const scheme = current.scheme ?? 'Bearer'
    if (current.sendAs === 'query') {
      if (qs) {
        const paramName = current.queryParamName ?? 'access_token'
        qs[paramName] = token
      }
      return
    }

    const headerName = current.headerName ?? 'Authorization'
    headers[headerName] = `${scheme} ${token}`
  }
}
