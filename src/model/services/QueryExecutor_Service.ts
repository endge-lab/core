import type { QueryProgramOutput, QueryProgramPayload } from '@/domain/types/program.types'
import type { RQueryAuth } from '@/domain/types/query.types'
import type { AxiosInstance } from 'axios'

import axios from 'axios'

import { Endge } from '@/model/endge/endge'
import { evaluateSourceExpression } from '@/model/services/source-engine/source-expression-evaluate'

export interface QueryExecutionContext {
  /** Runtime-ready query payload из Endge.program. */
  payload: QueryProgramPayload

  /** Входные параметры одноразового или реактивного запуска. */
  vars?: Record<string, unknown>

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

  /** Выполняет только transport/mock слой; output graph материализует QueryRuntimeHost через Raph. */
  public async execute(context: QueryExecutionContext): Promise<any> {
    return context.payload.mockDataEnabled
      ? this._readMockData(context.payload.mockData)
      : await this._executeByProtocol(context.payload, context.vars ?? {}, context.signal)
  }

  /** Извлекает response-backed source output без запуска DataView. */
  public readResponseOutput(
    output: QueryProgramOutput,
    response: unknown,
  ): unknown {
    if (output.source.type !== 'response')
      throw new Error(`Query output "${output.key}" is not response-backed.`)
    if (output.source.expression)
      return evaluateSourceExpression(output.source.expression, { response })
    return output.source.path == null ? response : this._path(response, output.source.path)
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
