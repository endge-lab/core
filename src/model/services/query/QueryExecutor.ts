import type { QueryProgramOutput, QueryProgramPayload } from '@/domain/types/program/program.types'
import type { RQueryAuth } from '@/domain/types/document/query.types'
import type { QueryExecutionContext } from '@/domain/types/runtime/query-execution.types'
import type { SourceExpressionIR } from '@/domain/types/source/source-expression.types'
import type { AxiosInstance } from 'axios'

import axios from 'axios'

import { Endge } from '@/model/endge/kernel/endge'
import { evaluateSourceExpression } from '@/model/services/source-engine/source-expression-evaluate'

/** Выполняет source-only compiled query artifact. */
export class QueryExecutor {
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
      return evaluateSourceExpression(output.source.expression, {
        response,
        onWarning: warning => this._writeExpressionWarning(warning.message, warning.data),
      })
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
    const endpointSource = String(this._evaluateRequestValue(payload.endpoint, vars) ?? '')
    const queryPathSource = String(this._evaluateRequestValue(payload.query, vars) ?? '')
    const endpoint = Endge.workspace.variables.resolve(endpointSource) || endpointSource
    const queryPath = Endge.workspace.variables.resolve(queryPathSource) || queryPathSource
    const url = this._buildUrl(endpoint, queryPath)
    const method = String(this._evaluateRequestValue(payload.method, vars) ?? 'POST').toUpperCase() as
      | 'GET'
      | 'POST'
      | 'PUT'
      | 'PATCH'
      | 'DELETE'
    const headers = this._asHeaders(this._evaluateRequestValue(payload.headers, vars))

    const sourceBody = payload.requestBody
      ? this._evaluateRequestValue(payload.requestBody, vars)
      : {}
    const sendAsFormUrlencoded = Boolean(this._evaluateRequestValue(payload.sendAsFormUrlencoded, vars))
    const timeoutMs = this._asOptionalNumber(this._evaluateRequestValue(payload.timeoutMs, vars))
    const auth = this._evaluateRequestValue(payload.auth, vars) as RQueryAuth | undefined

    let data: any
    let params: Record<string, any> | undefined

    if (method === 'GET' || method === 'DELETE') {
      params = this._asRecord(sourceBody)
    }
    else {
      const effectiveBody = this._asRecord(sourceBody)

      if (sendAsFormUrlencoded) {
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

    await this._applyAuth(auth, headers, (params ??= {}))

    try {
      const response = await this.http.request({
        url,
        method,
        headers,
        params,
        data,
        timeout: timeoutMs,
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

  /** Публикует runtime warning безопасного expression evaluator. */
  private _writeExpressionWarning(message: string, data?: unknown): void {
    void data
    if (Endge.isConfigured) {
      Endge.diagnostics.warn(`[Query] ${message}`, {
        scope: { name: 'endge.runtime.query' },
        eventName: 'endge.expression.warning',
      })
    }
  }

  private _asRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, any>
      : {}
  }

  /** Evaluates a compiled request expression while accepting legacy static payload fields. */
  private _evaluateRequestValue(value: unknown, props: Record<string, unknown>): unknown {
    if (!this._isSourceExpression(value))
      return value
    return evaluateSourceExpression(value, {
      props,
      environment: name => Endge.workspace.variables.resolve(`{${name}}`) || `{${name}}`,
      onWarning: warning => this._writeExpressionWarning(warning.message, warning.data),
    })
  }

  private _isSourceExpression(value: unknown): value is SourceExpressionIR {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false
    const candidate = value as Record<string, unknown>
    if (candidate.type === 'literal')
      return Object.prototype.hasOwnProperty.call(candidate, 'value')
    if (candidate.type === 'object')
      return Boolean(candidate.properties && typeof candidate.properties === 'object' && !Array.isArray(candidate.properties))
    if (candidate.type === 'array')
      return Array.isArray(candidate.items)
    if (candidate.type === 'read')
      return typeof candidate.source === 'string' && typeof candidate.path === 'string'
    if (candidate.type === 'operation')
      return typeof candidate.operation === 'string' && Array.isArray(candidate.arguments)
    return false
  }

  private _asHeaders(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return {}
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== null && entry !== undefined)
        .map(([key, entry]) => [key, String(entry)]),
    )
  }

  private _asOptionalNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === '')
      return undefined
    const number = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(number) ? number : undefined
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

    const session = await Endge.auth.profiles.resolveRequestAuth(current)
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
