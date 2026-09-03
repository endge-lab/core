import type { AxiosInstance } from 'axios'
import type { AuthRequestPolicy, AuthResolvedSession, AuthResolveOptions } from '@/modules/auth/domain/types/auth-profile.types'
import type { RQueryAuth } from '@/modules/domain/types/document/query.types'
import type { QueryProgramOutput, QueryProgramPayload } from '@/modules/program/domain/types/program.types'
import type { QueryExecutionContext } from '@/modules/runtime/domain/query-execution.types'
import type { SourceExpressionIR } from '@/modules/source/domain/types/source-expression.types'

import axios from 'axios'

import { evaluateSourceExpression } from '@/modules/source/services/source-expression-evaluate'

export interface QueryExecutorDependencies {
  resolveVariable: (source: string) => string
  resolveAuth: (policy: AuthRequestPolicy, options?: AuthResolveOptions) => Promise<AuthResolvedSession>
  reportWarning: (message: string, data?: unknown) => void
}

/** Выполняет source-only compiled query artifact. */
export class QueryExecutor_Adapter {
  /** Transport capability для REST и GraphQL requests. */
  private readonly _http: AxiosInstance

  /**
   * ----------------------------------------
   * PUBLIC
   * ----------------------------------------
   */

  public constructor(
    private readonly _dependencies: QueryExecutorDependencies,
    http: AxiosInstance = axios.create({
      headers: { Accept: 'application/json' },
    }),
  ) {
    this._http = http
  }

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
    if (output.source.type !== 'response') {
      throw new Error(`Query output "${output.key}" is not response-backed.`)
    }
    if (output.source.expression) {
      return evaluateSourceExpression(output.source.expression, {
        response,
        onWarning: warning => this._writeExpressionWarning(warning.message, warning.data),
      })
    }
    return output.source.path == null ? response : this._path(response, output.source.path)
  }

  /**
   * ----------------------------------------
   * PRIVATE
   * ----------------------------------------
   */

  /** Выбирает protocol executor по compiled artifact type. */
  private async _executeByProtocol(
    payload: QueryProgramPayload,
    vars: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<any> {
    if (payload.type === 'query-rest') {
      return this._runRest(payload, vars, signal)
    }
    if (payload.type === 'query-gql') {
      return this._runGraphQL(payload, vars, signal)
    }

    throw new Error(`Unsupported query artifact type: ${payload.type}`)
  }

  /** Выполняет GraphQL operation и возвращает ее data, отделяя transport errors от GraphQL errors. */
  private async _runGraphQL(
    payload: QueryProgramPayload,
    vars: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<any> {
    const endpointSource = String(this._evaluateRequestValue(payload.endpoint, vars) ?? '')
    const url = this._resolveVariable(endpointSource)
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...this._asHeaders(this._evaluateRequestValue(payload.headers, vars)),
    }
    const requestVariables = payload.requestVariables
      ? this._asRecord(this._evaluateRequestValue(payload.requestVariables, vars))
      : {}
    const timeoutMs = this._asOptionalNumber(this._evaluateRequestValue(payload.timeoutMs, vars))
    const auth = this._evaluateRequestValue(payload.auth, vars) as RQueryAuth | undefined
    const params: Record<string, unknown> = {}
    await this._applyAuth(auth, headers, params)

    try {
      const response = await this._http.request({
        url,
        method: 'POST',
        headers,
        params,
        data: {
          query: String(payload.query ?? ''),
          ...(payload.operationName ? { operationName: payload.operationName } : {}),
          variables: requestVariables,
        },
        timeout: timeoutMs,
        signal,
      })
      const envelope = this._asRecord(response.data)
      const errors = Array.isArray(envelope.errors) ? envelope.errors : []
      if (errors.length > 0) {
        const messages = errors.map((error) => {
          const entry = this._asRecord(error)
          return typeof entry.message === 'string' ? entry.message : JSON.stringify(error)
        })
        this._writeRequestError({
          protocol: 'GraphQL',
          method: 'POST',
          url,
          operationName: payload.operationName,
          status: response.status,
          message: messages.join('; '),
        })
        if ((payload.errorPolicy ?? 'throw') === 'throw') {
          throw new Error(`[GraphQL] ${messages.join('; ')}`)
        }
      }
      return envelope.data ?? null
    }
    catch (error: any) {
      if (String(error?.message ?? '').startsWith('[GraphQL]')) {
        throw error
      }
      this._throwHttpError(error, {
        protocol: 'GraphQL',
        method: 'POST',
        url,
        operationName: payload.operationName,
      }, signal)
    }
  }

  /** Выполняет REST artifact. */
  private async _runRest(
    payload: QueryProgramPayload,
    vars: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<any> {
    const endpointSource = String(this._evaluateRequestValue(payload.endpoint, vars) ?? '')
    const queryPathSource = String(this._evaluateRequestValue(payload.query, vars) ?? '')
    const endpoint = this._resolveVariable(endpointSource)
    const queryPath = this._resolveVariable(queryPathSource)
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
          if (value === null || value === undefined) {
            continue
          }
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
      const response = await this._http.request({
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
      this._throwHttpError(error, {
        protocol: 'REST',
        method,
        url,
      }, signal)
    }
  }

  private _throwHttpError(
    error: any,
    request: {
      protocol: 'REST' | 'GraphQL'
      method: string
      url: string
      operationName?: string
    },
    signal?: AbortSignal,
  ): never {
    if (signal?.aborted || error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' || error?.name === 'AbortError') {
      throw error
    }
    const status = error?.response?.status
    const statusText = error?.response?.statusText
    const responsePayload = error?.response?.data
    const message = status
      ? `HTTP ${status} ${statusText || ''} at ${request.url}`
      : `HTTP error at ${request.url}`
    const details = typeof responsePayload === 'string'
      ? responsePayload
      : JSON.stringify(responsePayload ?? {})

    this._writeRequestError({
      ...request,
      status,
      statusText,
      message: status ? undefined : String(error?.message ?? 'Network error'),
    })
    throw new Error(`${message}\n${details}`)
  }

  /** Пишет краткую transport-индикацию без request body, headers и response payload. */
  private _writeRequestError(input: {
    protocol: 'REST' | 'GraphQL'
    method: string
    url: string
    operationName?: string
    status?: number
    statusText?: string
    message?: string
  }): void {
    const operation = input.protocol === 'GraphQL' && input.operationName
      ? ` ${input.operationName}`
      : ''
    const status = input.status
      ? `HTTP ${input.status}${input.statusText ? ` ${input.statusText}` : ''}`
      : null
    const reason = [status, input.message].filter(Boolean).join(': ') || 'Request failed'

    console.error(`[QueryExecutor_Adapter] ${input.protocol}${operation} ${input.method} ${input.url} failed: ${reason}`)
  }

  /** Публикует runtime warning безопасного expression evaluator. */
  private _writeExpressionWarning(message: string, data?: unknown): void {
    this._dependencies.reportWarning(message, data)
  }

  private _asRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, any>
      : {}
  }

  /** Evaluates a compiled request expression while accepting legacy static payload fields. */
  private _evaluateRequestValue(value: unknown, props: Record<string, unknown>): unknown {
    if (!this._isSourceExpression(value)) {
      return value
    }
    return evaluateSourceExpression(value, {
      props,
      environment: name => this._resolveVariable(`{${name}}`),
      onWarning: warning => this._writeExpressionWarning(warning.message, warning.data),
    })
  }

  private _isSourceExpression(value: unknown): value is SourceExpressionIR {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false
    }
    const candidate = value as Record<string, unknown>
    if (candidate.type === 'literal') {
      return Object.hasOwn(candidate, 'value')
    }
    if (candidate.type === 'object') {
      return Boolean(candidate.properties && typeof candidate.properties === 'object' && !Array.isArray(candidate.properties))
    }
    if (candidate.type === 'array') {
      return Array.isArray(candidate.items)
    }
    if (candidate.type === 'read') {
      return typeof candidate.source === 'string' && typeof candidate.path === 'string'
    }
    if (candidate.type === 'operation') {
      return typeof candidate.operation === 'string' && Array.isArray(candidate.arguments)
    }
    return false
  }

  private _asHeaders(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {}
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== null && entry !== undefined)
        .map(([key, entry]) => [key, String(entry)]),
    )
  }

  private _asOptionalNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === '') {
      return undefined
    }
    const number = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(number) ? number : undefined
  }

  /** Читает mock payload из artifact. */
  private _readMockData(raw: unknown): any {
    if (typeof raw !== 'string') {
      return raw
    }

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
      if (current == null) {
        return undefined
      }
      current = current[part]
    }
    return current
  }

  /** Безопасно склеивает endpoint и path. */
  private _buildUrl(base: string, path?: string | null): string {
    if (!path) {
      return base
    }

    const value = String(path)
    if (/^(?:https?:)?\/\//i.test(value)) {
      return value
    }

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

    const profile = String(current.profile ?? '').trim()
    if (current.mode === 'profile' && !profile) {
      throw new Error('[EndgeAuth] Auth profile is required for profile mode.')
    }
    const session = await this._dependencies.resolveAuth(
      current.mode === 'profile'
        ? { mode: 'profile', profile }
        : { mode: 'inherit' },
    )
    const token = session.accessToken
    if (current.sendAs === 'query') {
      if (token && qs) {
        const paramName = current.queryParamName ?? 'access_token'
        qs[paramName] = token
      }
      return
    }

    if (!current.headerName && !current.scheme) {
      Object.assign(headers, session.headers)
      return
    }
    if (!token) {
      throw new Error(`[EndgeAuth] Profile "${session.profileIdentity}" does not expose a token for custom Query auth mapping`)
    }
    const scheme = current.scheme ?? 'Bearer'
    const headerName = current.headerName ?? 'Authorization'
    headers[headerName] = `${scheme} ${token}`
  }

  /** Разрешает environment placeholder через переданный composition owner. */
  private _resolveVariable(source: string): string {
    return this._dependencies.resolveVariable(source) || source
  }
}
