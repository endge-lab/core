import type { AxiosInstance } from 'axios'
import type { AuthRequestPolicy, AuthResolvedSession, AuthResolveOptions } from '@/features/core/modules/auth/domain/types/auth-profile.types'
import type { RQueryAuth } from '@/features/core/modules/domain/types/document/query.types'
import type { QueryProgramOutput, QueryProgramPayload } from '@/features/core/modules/program/domain/types/program.types'
import type { GraphQLResponseError } from '@/features/core/modules/runtime/domain/graphql-query-error'
import type {
  QueryExecutionContext,
  QueryExecutionObserver,
  QueryExecutionRequest,
  QueryExecutionResponse,
} from '@/features/core/modules/runtime/domain/query-execution.types'
import type { SourceExpressionIR } from '@/features/core/modules/source/domain/types/source-expression.types'

import axios from 'axios'

import {
  formatGraphQLResponseErrors,
  GraphQLQueryError,
  GraphQLResponseFormatError,
  normalizeGraphQLResponseError,
  readGraphQLExecutionResult,
} from '@/features/core/modules/runtime/domain/graphql-query-error'
import { evaluateSourceExpression } from '@/features/core/modules/source/services/source-expression-evaluate'
import { readValuePath } from '@/features/core/modules/source/services/value-path'

export interface QueryExecutorDependencies {
  resolveVariable: (source: string) => string
  resolveAuth: (policy: AuthRequestPolicy, options?: AuthResolveOptions) => Promise<AuthResolvedSession>
  reportWarning: (message: string, data?: unknown) => void
  // Публикует GraphQL errors ответа при errorPolicy: 'all'.
  reportGraphQLErrors?: (input: { url: string, operationName?: string, errors: readonly GraphQLResponseError[] }) => void
}

/**
 * Выполняет source-only compiled query artifact.
 */
export class QueryExecutor_Adapter {
  // Transport capability для REST и GraphQL requests.
  private readonly _http: AxiosInstance

  public constructor(
    private readonly _dependencies: QueryExecutorDependencies,
    http: AxiosInstance = axios.create({
      headers: { Accept: 'application/json' },
    }),
  ) {
    this._http = http
  }

  // ---------------------------------------------
  // PUBLIC API
  // ---------------------------------------------

  /**
   * Выполняет только transport/mock слой; output graph материализует QueryRuntimeHost через Raph.
   */
  public async execute(context: QueryExecutionContext): Promise<any> {
    if (!context.payload.mockDataEnabled) {
      return await this._executeByProtocol(context.payload, context.vars ?? {}, context.signal, context.onGraphQLErrors, context)
    }
    const data = this._readMockData(context.payload.mockData)
    return context.payload.type === 'query-gql'
      ? this._readGraphQLMock(context.payload, data, context.vars ?? {}, context.onGraphQLErrors)
      : data
  }

  /**
   * Извлекает response-backed source output без запуска DataView.
   * graphQLErrors питают reader errors(path?) GraphQL Query.
   */
  public readResponseOutput(
    output: QueryProgramOutput,
    response: unknown,
    graphQLErrors: readonly GraphQLResponseError[] = [],
  ): unknown {
    if (output.source.type !== 'response') {
      throw new Error(`Query output "${output.key}" is not response-backed.`)
    }
    if (output.source.expression) {
      return evaluateSourceExpression(output.source.expression, {
        response,
        graphQLErrors,
        onWarning: warning => this._writeExpressionWarning(warning.message, warning.data),
      })
    }
    return output.source.path == null ? response : this._path(response, output.source.path)
  }

  // ---------------------------------------------
  // PRIVATE
  // ---------------------------------------------

  /**
   * Выбирает protocol executor по compiled artifact type.
   */
  private async _executeByProtocol(
    payload: QueryProgramPayload,
    vars: Record<string, unknown>,
    signal?: AbortSignal,
    onGraphQLErrors?: QueryExecutionContext['onGraphQLErrors'],
    observer: QueryExecutionObserver = {},
  ): Promise<any> {
    if (payload.type === 'query-rest') {
      return this._runRest(payload, vars, signal, observer)
    }
    if (payload.type === 'query-gql') {
      return this._runGraphQL(payload, vars, signal, onGraphQLErrors, observer)
    }

    throw new Error(`Unsupported query artifact type: ${payload.type}`)
  }

  /**
   * Выполняет GraphQL operation и возвращает ее data, отделяя transport errors от GraphQL errors.
   * errorPolicy 'throw' превращает errors в GraphQLQueryError с частичными data;
   * 'ignore' возвращает data и скрывает errors (onGraphQLErrors получает пустой массив);
   * 'all' возвращает data, передаёт errors в onGraphQLErrors и в diagnostics.
   */
  private async _runGraphQL(
    payload: QueryProgramPayload,
    vars: Record<string, unknown>,
    signal?: AbortSignal,
    onGraphQLErrors?: QueryExecutionContext['onGraphQLErrors'],
    observer: QueryExecutionObserver = {},
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
    const authKeys = await this._applyAuth(auth, headers, params)
    const body = {
      query: String(payload.query ?? ''),
      ...(payload.operationName ? { operationName: payload.operationName } : {}),
      variables: requestVariables,
    }
    this._notifyRequest(observer, {
      protocol: 'GraphQL',
      method: 'POST',
      url,
      headers,
      params,
      body,
      operationName: payload.operationName,
      timeoutMs,
      ...authKeys,
    })

    let response: { data: unknown, status?: number, statusText?: string, headers?: unknown }
    try {
      response = await this._http.request({
        url,
        method: 'POST',
        headers,
        params,
        data: body,
        timeout: timeoutMs,
        signal,
      })
    }
    catch (error: any) {
      this._throwHttpError(error, {
        protocol: 'GraphQL',
        method: 'POST',
        url,
        operationName: payload.operationName,
      }, signal, observer)
    }
    this._notifyResponse(observer, response)

    const request = { url, operationName: payload.operationName, status: response.status }
    const { data, errors } = this._readGraphQLEnvelope(response.data, {
      ...request,
      contentType: this._readContentType(response.headers),
    })
    return this._applyGraphQLErrorPolicy(payload, data, errors, request, onGraphQLErrors, (message) => {
      this._writeRequestError({
        protocol: 'GraphQL',
        method: 'POST',
        url,
        operationName: payload.operationName,
        status: response.status,
        message,
      })
    })
  }

  /**
   * Mock GraphQL Query: mock.data — data операции, mock.errors — errors ответа.
   * Errors проходят тот же errorPolicy, что ответ сервера; transport и console.error не задействуются.
   */
  private _readGraphQLMock(
    payload: QueryProgramPayload,
    data: unknown,
    vars: Record<string, unknown>,
    onGraphQLErrors?: QueryExecutionContext['onGraphQLErrors'],
  ): unknown {
    return this.applySimulatedGraphQLErrors(payload, data, payload.mockErrors, vars, onGraphQLErrors)
  }

  /**
   * Ответ без transport (mock Query или mockRequest Simulation): errors проходят тот же
   * errorPolicy, что ответ сервера; url ошибки — вычисленный endpoint Query.
   */
  public applySimulatedGraphQLErrors(
    payload: QueryProgramPayload,
    data: unknown,
    rawErrors: readonly unknown[] | undefined,
    vars: Record<string, unknown>,
    onGraphQLErrors?: QueryExecutionContext['onGraphQLErrors'],
  ): unknown {
    const errors = Array.isArray(rawErrors) ? rawErrors.map(normalizeGraphQLResponseError) : []
    const url = errors.length > 0 ? this._resolveVariable(String(this._evaluateRequestValue(payload.endpoint, vars) ?? '')) : ''
    return this._applyGraphQLErrorPolicy(payload, data, errors, { url, operationName: payload.operationName }, onGraphQLErrors)
  }

  /**
   * errorPolicy GraphQL-ответа: 'throw' — GraphQLQueryError с частичными data;
   * 'ignore' — data без errors (как в Apollo); 'all' — data, errors в reader errors() и в diagnostics.
   */
  private _applyGraphQLErrorPolicy(
    payload: QueryProgramPayload,
    data: unknown,
    errors: GraphQLResponseError[],
    request: { url: string, operationName?: string, status?: number },
    onGraphQLErrors?: QueryExecutionContext['onGraphQLErrors'],
    writeThrowError?: (message: string) => void,
  ): unknown {
    const errorPolicy = payload.errorPolicy ?? 'throw'
    if (errors.length > 0) {
      if (errorPolicy === 'throw') {
        writeThrowError?.(formatGraphQLResponseErrors(errors))
        throw new GraphQLQueryError(errors, data, request)
      }
      if (errorPolicy === 'all') {
        this._dependencies.reportGraphQLErrors?.({ url: request.url, operationName: request.operationName, errors })
      }
    }
    onGraphQLErrors?.(errorPolicy === 'all' ? errors : [])
    return data
  }

  /**
   * Проверяет оболочку GraphQL response: JSON-объект с data и/или массивом errors.
   */
  private _readGraphQLEnvelope(
    body: unknown,
    request: { url: string, operationName?: string, status?: number, contentType?: string },
  ): { data: unknown, errors: GraphQLResponseError[] } {
    try {
      return readGraphQLExecutionResult(body, request)
    }
    catch (error) {
      if (error instanceof GraphQLResponseFormatError) {
        this._writeRequestError({
          protocol: 'GraphQL',
          method: 'POST',
          url: request.url,
          operationName: request.operationName,
          status: request.status,
          message: error.reason,
        })
      }
      throw error
    }
  }

  private _readContentType(headers: unknown): string | undefined {
    if (!headers || typeof headers !== 'object') {
      return undefined
    }
    const record = headers as Record<string, unknown> & { get?: (name: string) => unknown }
    const value = typeof record.get === 'function'
      ? record.get('content-type')
      : record['content-type'] ?? record['Content-Type']
    return typeof value === 'string' && value ? value : undefined
  }

  /**
   * Выполняет REST artifact.
   */
  private async _runRest(
    payload: QueryProgramPayload,
    vars: Record<string, unknown>,
    signal?: AbortSignal,
    observer: QueryExecutionObserver = {},
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

    const authKeys = await this._applyAuth(auth, headers, (params ??= {}))
    this._notifyRequest(observer, {
      protocol: 'REST',
      method,
      url,
      headers,
      params,
      body: data,
      timeoutMs,
      ...authKeys,
    })

    let response: { data: unknown, status?: number, statusText?: string, headers?: unknown }
    try {
      response = await this._http.request({
        url,
        method,
        headers,
        params,
        data,
        timeout: timeoutMs,
        signal,
      })
    }
    catch (error: any) {
      this._throwHttpError(error, {
        protocol: 'REST',
        method,
        url,
      }, signal, observer)
    }
    this._notifyResponse(observer, response)
    return response.data
  }

  /**
   * Передаёт наблюдателю снимок итогового запроса; изменения снимка не влияют на отправку.
   */
  private _notifyRequest(observer: QueryExecutionObserver, request: QueryExecutionRequest): void {
    if (!observer.onRequest) {
      return
    }
    observer.onRequest({
      ...request,
      headers: { ...request.headers },
      params: { ...request.params },
    })
  }

  /**
   * Передаёт наблюдателю HTTP-ответ транспорта, включая ответы с кодом ошибки.
   */
  private _notifyResponse(
    observer: QueryExecutionObserver,
    response: { data?: unknown, status?: number, statusText?: string, headers?: unknown } | undefined,
  ): void {
    if (!observer.onResponse || !response) {
      return
    }
    const result: QueryExecutionResponse = {
      status: response.status,
      statusText: response.statusText || undefined,
      headers: this._plainHeaders(response.headers),
      data: response.data,
    }
    observer.onResponse(result)
  }

  private _plainHeaders(headers: unknown): Record<string, string> {
    if (!headers || typeof headers !== 'object') {
      return {}
    }
    const record = headers as Record<string, unknown> & { toJSON?: () => unknown }
    const source = typeof record.toJSON === 'function' ? record.toJSON() : record
    if (!source || typeof source !== 'object') {
      return {}
    }
    return Object.fromEntries(
      Object.entries(source as Record<string, unknown>)
        .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'function')
        .map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)]),
    )
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
    observer: QueryExecutionObserver = {},
  ): never {
    if (signal?.aborted || error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' || error?.name === 'AbortError') {
      throw error
    }
    this._notifyResponse(observer, error?.response)
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

  /**
   * Пишет краткую transport-индикацию без request body, headers и response payload.
   */
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

  /**
   * Публикует runtime warning безопасного expression evaluator.
   */
  private _writeExpressionWarning(message: string, data?: unknown): void {
    this._dependencies.reportWarning(message, data)
  }

  private _asRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, any>
      : {}
  }

  /**
   * Вычисляет скомпилированное выражение запроса с поддержкой legacy-полей статической нагрузки.
   */
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

  /**
   * Читает mock payload из artifact.
   */
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

  /**
   * Читает путь value DSL (точечный или DataPath Raph) из backend response без исключений.
   */
  private _path(source: unknown, path: string): unknown {
    return readValuePath(source, String(path ?? ''))
  }

  /**
   * Безопасно склеивает endpoint и path.
   */
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

  /**
   * Применяет auth к headers или query params.
   */
  private async _applyAuth(
    auth: RQueryAuth | undefined,
    headers: Record<string, string>,
    qs?: Record<string, unknown>,
  ): Promise<{ authHeaders: string[], authParams: string[] }> {
    const current: RQueryAuth = auth ?? { mode: 'inherit' }

    if (current.mode === 'none') {
      const headerName = current.headerName ?? 'Authorization'
      delete headers[headerName]
      return { authHeaders: [], authParams: [] }
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
        return { authHeaders: [], authParams: [paramName] }
      }
      return { authHeaders: [], authParams: [] }
    }

    if (!current.headerName && !current.scheme) {
      Object.assign(headers, session.headers)
      return { authHeaders: Object.keys(session.headers ?? {}), authParams: [] }
    }
    if (!token) {
      throw new Error(`[EndgeAuth] Profile "${session.profileIdentity}" does not expose a token for custom Query auth mapping`)
    }
    const scheme = current.scheme ?? 'Bearer'
    const headerName = current.headerName ?? 'Authorization'
    headers[headerName] = `${scheme} ${token}`
    return { authHeaders: [headerName], authParams: [] }
  }

  /**
   * Разрешает environment placeholder через переданный composition owner.
   */
  private _resolveVariable(source: string): string {
    return this._dependencies.resolveVariable(source) || source
  }
}
