import type { RQuery } from '@/domain/entities/reflect/RQuery'
import type { ProgramArtifact, QueryProgramOutput, QueryProgramPayload } from '@/domain/types/program.types'
import type { RQueryAuth } from '@/domain/types/query.types'
import type { AxiosInstance } from 'axios'

import { Raph } from '@endge/raph'
import axios from 'axios'

import { Endge } from '@/model/endge/endge'
import { evaluateSourceExpression } from '@/domain/services/source-engine/source-expression-evaluate'

export interface QueryExecutionContext {
  /** Доменный query, которому принадлежит artifact. */
  query: RQuery

  /** Runtime-ready query payload из Endge.program. */
  payload: QueryProgramPayload

  /** Локальные artifacts, принадлежащие query artifact. */
  children?: ProgramArtifact[]

  /** Входные параметры одноразового или реактивного запуска. */
  vars?: Record<string, unknown>

  /** Отложить запись stores до проверки latest-wins в QueryRuntimeHost. */
  writeStores?: boolean

  /** AbortSignal текущего runtime run. */
  signal?: AbortSignal
}

/** Выполняет source-only compiled query artifact. */
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
      : await this._executeByProtocol(context.payload, context.vars ?? {}, context.signal)

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
      if (output.store && context.writeStores !== false)
        Raph.set(this._resolveStoreKey(output, context.query, context.vars ?? {}), value)
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
  public writeOutputStores(
    payload: QueryProgramPayload,
    query: RQuery,
    props: Record<string, unknown>,
    values: Record<string, unknown>,
  ): void {
    for (const output of payload.outputs) {
      if (output.store)
        Raph.set(this._resolveStoreKey(output, query, props), values[output.key])
    }
  }

  private _resolveStoreKey(output: QueryProgramOutput, query: RQuery, props: Record<string, unknown> = {}): string {
    if (output.store?.mode === 'prop' && output.store.prop) {
      const key = String(props[output.store.prop] ?? '').trim()
      if (!key)
        throw new Error(`Query output "${output.key}" store prop "${output.store.prop}" is empty.`)
      return key
    }
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
    signal?: AbortSignal,
  ): Promise<any> {
    if (payload.type === 'query-rest')
      return this._runRest(payload, vars, signal)

    throw new Error(`Unsupported query artifact type: ${payload.type}`)
  }

  /** Выполняет REST artifact. */
  private async _runRest(
    payload: QueryProgramPayload,
    vars: Record<string, unknown>,
    signal?: AbortSignal,
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

    const sourceBody = payload.requestBody
      ? evaluateSourceExpression(payload.requestBody, { props: vars ?? {} })
      : {}

    let data: any
    let params: Record<string, any> | undefined

    if (method === 'GET' || method === 'DELETE') {
      params = this._asRecord(sourceBody)
    }
    else {
      const effectiveBody = this._asRecord(sourceBody)

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
        signal,
      })
      return response.data
    }
    catch (error: any) {
      if (signal?.aborted || error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' || error?.name === 'AbortError')
        throw error
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

  private _asRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, any>
      : {}
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
