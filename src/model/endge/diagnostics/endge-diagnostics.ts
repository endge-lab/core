import type { EndgeBootContext } from '@/domain/types/kernel/bootstrap.types'
import { DiagnosticsRecordStore } from '@/domain/entities/diagnostics/DiagnosticsRecordStore'
import { DiagnosticsSpan } from '@/domain/entities/diagnostics/DiagnosticsSpan'
import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import type {
  DiagnosticsAdapter,
  DiagnosticsAttributes,
  DiagnosticsAttributeValue,
  DiagnosticsCounters,
  DiagnosticsExceptionOptions,
  DiagnosticsFilter,
  DiagnosticsFlushResult,
  DiagnosticsInstrumentationScope,
  DiagnosticsListener,
  DiagnosticsLogInput,
  DiagnosticsLogOptions,
  DiagnosticsLogRecord,
  DiagnosticsRecord,
  DiagnosticsResource,
  DiagnosticsSeverityNumber,
  DiagnosticsSignal,
  DiagnosticsSnapshot,
  DiagnosticsSnapshotOptions,
  DiagnosticsSpanEndOptions,
  DiagnosticsSpanHandle,
  DiagnosticsSpanOptions,
  DiagnosticsSpanOwner,
  DiagnosticsSpanRecord,
  DiagnosticsSubscribeOptions,
  EndgeDiagnosticsConfiguration,
} from '@/domain/types/diagnostics'
import {
  DEFAULT_ENDGE_DIAGNOSTICS_CONFIGURATION,
  DIAGNOSTICS_SEVERITY_TEXT,
} from '@/model/config/diagnostics'
import { Endge } from '@/model/endge/kernel/endge'

const DEFAULT_SCOPE: DiagnosticsInstrumentationScope = { name: 'endge.core' }
const REDACTED_VALUE = '[REDACTED]'
const SENSITIVE_ATTRIBUTE_PARTS = ['authorization', 'cookie', 'credential', 'password', 'secret', 'token']

interface DiagnosticsSubscription {
  filter: DiagnosticsFilter
  listener: DiagnosticsListener
}

/**
 * Централизованный модуль диагностики Endge.
 * Собирает logs и завершённые spans, хранит bounded session history и маршрутизирует records в adapters.
 */
export class EndgeDiagnostics extends EndgeModule implements DiagnosticsSpanOwner {
  private _configuration = this._cloneConfiguration(DEFAULT_ENDGE_DIAGNOSTICS_CONFIGURATION)
  private _resource: DiagnosticsResource = { attributes: { 'service.name': 'endge' } }
  private _store = new DiagnosticsRecordStore(this._configuration.collection.maxRecords)
  private readonly _adapters = new Map<string, DiagnosticsAdapter>()
  private readonly _subscriptions = new Set<DiagnosticsSubscription>()
  private readonly _activeSpans = new Map<string, DiagnosticsSpan>()
  private _sessionId = this._createSessionId()
  private _recordId = 0
  private _droppedByPolicy = 0
  private _droppedByCapacity = 0
  private _adapterFailures = 0
  private _listenerFailures = 0
  private _notifyScheduled = false

  /** Возвращает идентификатор текущей diagnostics session. */
  public get sessionId(): string {
    return this._sessionId
  }

  /** Возвращает независимую копию effective diagnostics configuration. */
  public get configuration(): EndgeDiagnosticsConfiguration {
    return this._cloneConfiguration(this._configuration)
  }

  /** Возвращает независимую копию resource текущего запуска. */
  public get resource(): DiagnosticsResource {
    return { attributes: this._cloneAttributes(this._resource.attributes) }
  }

  /** Применяет effective configuration после разрешения build context. */
  public override build(_ctx: EndgeBootContext): void {
    if (!Endge.configuration.isResolved)
      return

    const context = Endge.configuration.buildContext
    this.configure(context.configuration.diagnostics, {
      attributes: {
        'service.name': 'endge',
        'endge.workspace.id': context.workspaceIdentity,
        'endge.tenant.id': context.execution.tenantIdentity,
        'endge.project.id': context.execution.projectIdentity,
        'deployment.environment.name': context.execution.environmentIdentity,
      },
    })
  }

  /**
   * Завершает текущую session, доставляет buffered data и освобождает adapters.
   * После reset модуль готов к следующему boot lifecycle.
   */
  public override async reset(): Promise<void> {
    for (const span of [...this._activeSpans.values()])
      span.end({ status: 'error', message: 'Endge diagnostics session reset' })

    await this.flush()
    await Promise.allSettled(
      [...this._adapters.values()].map(adapter => Promise.resolve().then(() => adapter.dispose?.())),
    )

    this._adapters.clear()
    this._subscriptions.clear()
    this._activeSpans.clear()
    this._store.clear()
    this._sessionId = this._createSessionId()
    this._recordId = 0
    this._droppedByPolicy = 0
    this._droppedByCapacity = 0
    this._adapterFailures = 0
    this._listenerFailures = 0
    this._scheduleNotify()
  }

  /** Применяет collection/routes configuration и resource без привязки к UI. */
  public configure(configuration: EndgeDiagnosticsConfiguration, resource: DiagnosticsResource = this._resource): void {
    const signals = [...new Set(configuration.collection.signals.filter(signal => signal === 'log' || signal === 'span'))]
    this._configuration = {
      collection: {
        enabled: configuration.collection.enabled !== false,
        signals,
        minSeverity: this._normalizeSeverity(configuration.collection.minSeverity),
        maxRecords: Math.max(1, Math.floor(Number(configuration.collection.maxRecords) || 2_000)),
      },
      routes: configuration.routes.map(route => ({
        ...route,
        match: this._cloneFilter(route.match),
        target: { ...route.target },
      })),
    }
    this._resource = { attributes: this._normalizeAttributes(resource.attributes) }
    this._store.setCapacity(this._configuration.collection.maxRecords)
    this._scheduleNotify()
  }

  /** Записывает один нормализованный structured log. */
  public log(input: DiagnosticsLogInput): DiagnosticsLogRecord | null {
    const severityNumber = this._normalizeSeverity(input.severityNumber)
    if (!this._canCollect('log', severityNumber))
      return null

    const record: DiagnosticsLogRecord = {
      id: this._nextRecordId(),
      signal: 'log',
      timestamp: this._normalizeTimestamp(input.timestamp),
      ...(input.observedTimestamp != null ? { observedTimestamp: this._normalizeTimestamp(input.observedTimestamp) } : {}),
      severityNumber,
      severityText: DIAGNOSTICS_SEVERITY_TEXT[severityNumber],
      body: String(input.body ?? ''),
      ...(this._normalizeText(input.eventName) ? { eventName: this._normalizeText(input.eventName) } : {}),
      scope: this._normalizeScope(input.scope),
      attributes: this._normalizeAttributes(input.attributes),
      ...this._normalizeCorrelation(input),
    }

    this._appendRecord(record)
    return record
  }

  /** Записывает log уровня TRACE. */
  public trace(body: string, options: DiagnosticsLogOptions = {}): DiagnosticsLogRecord | null {
    return this.log({ ...options, body, severityNumber: 1 })
  }

  /** Записывает log уровня DEBUG. */
  public debug(body: string, options: DiagnosticsLogOptions = {}): DiagnosticsLogRecord | null {
    return this.log({ ...options, body, severityNumber: 5 })
  }

  /** Записывает log уровня INFO. */
  public info(body: string, options: DiagnosticsLogOptions = {}): DiagnosticsLogRecord | null {
    return this.log({ ...options, body, severityNumber: 9 })
  }

  /** Записывает log уровня WARN. */
  public warn(body: string, options: DiagnosticsLogOptions = {}): DiagnosticsLogRecord | null {
    return this.log({ ...options, body, severityNumber: 13 })
  }

  /** Записывает log уровня ERROR без обязательного объекта exception. */
  public error(body: string, options: DiagnosticsLogOptions = {}): DiagnosticsLogRecord | null {
    return this.log({ ...options, body, severityNumber: 17 })
  }

  /** Записывает log уровня FATAL; метод не останавливает runtime самостоятельно. */
  public fatal(body: string, options: DiagnosticsLogOptions = {}): DiagnosticsLogRecord | null {
    return this.log({ ...options, body, severityNumber: 21 })
  }

  /** Нормализует пойманное исключение в ERROR/FATAL log с exception.* attributes. */
  public recordException(error: unknown, options: DiagnosticsExceptionOptions = {}): DiagnosticsLogRecord | null {
    const normalized = this._normalizeException(error)
    return this.log({
      ...options,
      body: normalized.message,
      eventName: options.eventName ?? 'exception',
      severityNumber: options.severityNumber ?? 17,
      attributes: {
        ...options.attributes,
        'exception.type': normalized.type,
        'exception.message': normalized.message,
        ...(normalized.stacktrace ? { 'exception.stacktrace': normalized.stacktrace } : {}),
      },
    })
  }

  /** Создаёт root или child span и возвращает correlation handle. */
  public startSpan(name: string, options: DiagnosticsSpanOptions = {}): DiagnosticsSpanHandle {
    const traceId = this._normalizeTraceId(options.traceId) ?? this._randomHex(32)
    const spanId = this._randomHex(16)
    const parentSpanId = this._normalizeSpanId(options.parentSpanId)
    const span = new DiagnosticsSpan(
      this,
      traceId,
      spanId,
      parentSpanId,
      this._normalizeTraceFlags(options.traceFlags),
      this._normalizeText(name) || 'span',
      this._normalizeScope(options.scope),
      this._normalizeTimestamp(options.startTimestamp),
      this._normalizeAttributes(options.attributes),
    )

    if (this._canCollect('span'))
      this._activeSpans.set(spanId, span)

    return span
  }

  /** Завершает активный span и сохраняет один итоговый span record. */
  public finishSpan(input: {
    traceId: string
    spanId: string
    parentSpanId?: string
    traceFlags?: number
    name: string
    scope: DiagnosticsInstrumentationScope
    startTimestamp: number
    attributes: DiagnosticsAttributes
    options?: DiagnosticsSpanEndOptions
  }): DiagnosticsSpanRecord | null {
    if (!this._activeSpans.delete(input.spanId))
      return null

    const endTimestamp = Math.max(input.startTimestamp, this._normalizeTimestamp(input.options?.endTimestamp))
    const status = input.options?.status ?? 'unset'
    const record: DiagnosticsSpanRecord = {
      id: this._nextRecordId(),
      signal: 'span',
      traceId: input.traceId,
      spanId: input.spanId,
      ...(input.parentSpanId ? { parentSpanId: input.parentSpanId } : {}),
      ...(input.traceFlags != null ? { traceFlags: input.traceFlags } : {}),
      name: input.name,
      scope: input.scope,
      startTimestamp: input.startTimestamp,
      endTimestamp,
      durationMs: endTimestamp - input.startTimestamp,
      status: {
        code: status,
        ...(this._normalizeText(input.options?.message) ? { message: this._normalizeText(input.options?.message) } : {}),
      },
      attributes: this._normalizeAttributes({ ...input.attributes, ...input.options?.attributes }),
    }

    this._appendRecord(record)
    return record
  }

  /** Подписывает listener на общие изменения Subscribable-модуля. */
  public override subscribe(listener: () => void): () => void

  /** Подписывает listener на отфильтрованный diagnostics stream. */
  public subscribe(filter: DiagnosticsFilter, listener: DiagnosticsListener, options?: DiagnosticsSubscribeOptions): () => void

  /** Реализует общую и records-specific формы подписки. */
  public subscribe(
    filterOrListener: DiagnosticsFilter | (() => void),
    listener?: DiagnosticsListener,
    options: DiagnosticsSubscribeOptions = {},
  ): () => void {
    if (typeof filterOrListener === 'function')
      return super.subscribe(filterOrListener)

    if (!listener)
      throw new Error('[EndgeDiagnostics] Record listener is required')

    const filter = filterOrListener
    const subscription: DiagnosticsSubscription = { filter: this._cloneFilter(filter), listener }
    this._subscriptions.add(subscription)

    if (options.replayStored) {
      for (const record of this.query(filter))
        this._notifyListener(listener, record)
    }

    return () => this._subscriptions.delete(subscription)
  }

  /** Возвращает read-only snapshot records, соответствующих filter. */
  public query(filter: DiagnosticsFilter = {}): readonly DiagnosticsRecord[] {
    let records = this._store.toArray()
    records = records.filter(record => this._matchesFilter(record, filter))
    return filter.limit != null && filter.limit > 0 ? records.slice(-filter.limit) : records
  }

  /** Возвращает snapshot configuration, resource, counters и optional records. */
  public snapshot(options: DiagnosticsSnapshotOptions = {}): DiagnosticsSnapshot {
    return {
      sessionId: this._sessionId,
      configuration: this.configuration,
      resource: this.resource,
      counters: this.getCounters(),
      ...(options.includeRecords ? { records: this.query(options.filter) } : {}),
    }
  }

  /** Возвращает счётчики текущей diagnostics session. */
  public getCounters(): DiagnosticsCounters {
    return {
      totalRecords: this._store.size,
      droppedByPolicy: this._droppedByPolicy,
      droppedByCapacity: this._droppedByCapacity,
      adapterFailures: this._adapterFailures,
      listenerFailures: this._listenerFailures,
      activeAdapters: this._adapters.size,
      activeSpans: this._activeSpans.size,
      recordsBySignal: this._store.getRecordsBySignal(),
      recordsByScope: this._store.getRecordsByScope(),
    }
  }

  /** Очищает локальную history и session counters без изменения configuration и adapters. */
  public clear(): void {
    this._store.clear()
    this._droppedByPolicy = 0
    this._droppedByCapacity = 0
    this._adapterFailures = 0
    this._listenerFailures = 0
    this._scheduleNotify()
  }

  /** Регистрирует adapter внешней доставки и возвращает функцию отключения. */
  public registerAdapter(adapter: DiagnosticsAdapter): () => void {
    const id = this._normalizeText(adapter.id)
    if (!id)
      throw new Error('[EndgeDiagnostics] Adapter id is required')
    if (this._adapters.has(id))
      throw new Error(`[EndgeDiagnostics] Adapter "${id}" is already registered`)

    this._adapters.set(id, adapter)
    this._scheduleNotify()
    return () => { void this.unregisterAdapter(id) }
  }

  /** Доставляет buffered data, освобождает adapter и удаляет его из registry. */
  public async unregisterAdapter(adapterId: string): Promise<void> {
    const id = this._normalizeText(adapterId)
    const adapter = this._adapters.get(id)
    if (!adapter)
      return

    try {
      await adapter.flush?.()
      await adapter.dispose?.()
    }
    catch {
      this._adapterFailures += 1
    }
    finally {
      this._adapters.delete(id)
      this._scheduleNotify()
    }
  }

  /** Выполняет best-effort flush всех adapters без reset модуля. */
  public async flush(): Promise<DiagnosticsFlushResult> {
    const result: DiagnosticsFlushResult = { succeeded: [], failed: [] }
    for (const [adapterId, adapter] of this._adapters.entries()) {
      try {
        await adapter.flush?.()
        result.succeeded.push(adapterId)
      }
      catch (error) {
        this._adapterFailures += 1
        result.failed.push({ adapterId, error })
      }
    }
    return result
  }

  /** Проверяет collection policy для signal и optional severity. */
  private _canCollect(signal: DiagnosticsSignal, severity?: DiagnosticsSeverityNumber): boolean {
    const collection = this._configuration.collection
    const allowed = collection.enabled
      && collection.signals.includes(signal)
      && (signal !== 'log' || (severity ?? 1) >= collection.minSeverity)

    if (!allowed)
      this._droppedByPolicy += 1
    return allowed
  }

  /** Добавляет record в store, subscribers и matching adapter routes. */
  private _appendRecord(record: DiagnosticsRecord): void {
    const immutableRecord = this._freezeRecord(record)
    if (this._store.append(immutableRecord))
      this._droppedByCapacity += 1

    for (const subscription of this._subscriptions) {
      if (this._matchesFilter(immutableRecord, subscription.filter))
        this._notifyListener(subscription.listener, immutableRecord)
    }

    for (const route of this._configuration.routes) {
      if (!route.enabled || !this._matchesFilter(immutableRecord, route.match))
        continue
      const adapter = this._adapters.get(route.target.adapterId)
      if (!adapter)
        continue

      try {
        const pending = adapter.accept(immutableRecord, {
          sessionId: this._sessionId,
          resource: this.resource,
          routeId: route.id,
          integrationId: route.target.integrationId,
        })
        if (pending)
          void Promise.resolve(pending).catch(() => { this._adapterFailures += 1 })
      }
      catch {
        this._adapterFailures += 1
      }
    }

    this._scheduleNotify()
  }

  /** Безопасно вызывает listener, не позволяя ему сломать producer. */
  private _notifyListener(listener: DiagnosticsListener, record: DiagnosticsRecord): void {
    try {
      listener(record)
    }
    catch {
      this._listenerFailures += 1
    }
  }

  /** Проверяет record по общему subscription/route filter. */
  private _matchesFilter(record: DiagnosticsRecord, filter: DiagnosticsFilter): boolean {
    if (filter.signals?.length && !filter.signals.includes(record.signal))
      return false
    if (filter.minSeverity != null && record.signal === 'log' && record.severityNumber < filter.minSeverity)
      return false
    if (filter.scopes?.length && !filter.scopes.includes(record.scope.name))
      return false
    if (filter.eventNames?.length && (record.signal !== 'log' || !record.eventName || !filter.eventNames.includes(record.eventName)))
      return false
    if (filter.traceId && record.traceId !== filter.traceId)
      return false
    if (filter.spanId && record.spanId !== filter.spanId)
      return false

    for (const [key, value] of Object.entries(filter.attributes ?? {})) {
      if (!this._attributeEquals(record.attributes[key], value))
        return false
    }
    return true
  }

  /** Сравнивает scalar/array attribute values без приведения типов. */
  private _attributeEquals(left: DiagnosticsAttributeValue | undefined, right: DiagnosticsAttributeValue): boolean {
    return Array.isArray(left) || Array.isArray(right)
      ? JSON.stringify(left) === JSON.stringify(right)
      : left === right
  }

  /** Нормализует и redacts attributes перед попаданием в core store. */
  private _normalizeAttributes(input: DiagnosticsAttributes | undefined): DiagnosticsAttributes {
    const attributes: DiagnosticsAttributes = {}
    for (const [rawKey, rawValue] of Object.entries(input ?? {})) {
      const key = this._normalizeText(rawKey)
      if (!key)
        continue
      attributes[key] = this._isSensitiveKey(key)
        ? REDACTED_VALUE
        : Array.isArray(rawValue) ? [...rawValue] : rawValue
    }
    return attributes
  }

  /** Клонирует attributes, включая array values, без повторного изменения ключей. */
  private _cloneAttributes(input: DiagnosticsAttributes): DiagnosticsAttributes {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
    )
  }

  /** Клонирует filter, чтобы внешние mutation не меняли subscription или route. */
  private _cloneFilter(filter: DiagnosticsFilter): DiagnosticsFilter {
    return {
      ...filter,
      ...(filter.signals ? { signals: [...filter.signals] } : {}),
      ...(filter.scopes ? { scopes: [...filter.scopes] } : {}),
      ...(filter.eventNames ? { eventNames: [...filter.eventNames] } : {}),
      ...(filter.attributes ? { attributes: this._cloneAttributes(filter.attributes) } : {}),
    }
  }

  /** Замораживает record и его вложенные структуры перед публикацией потребителям. */
  private _freezeRecord(record: DiagnosticsRecord): DiagnosticsRecord {
    for (const value of Object.values(record.attributes)) {
      if (Array.isArray(value))
        Object.freeze(value)
    }
    Object.freeze(record.attributes)
    Object.freeze(record.scope)
    if (record.signal === 'span')
      Object.freeze(record.status)
    return Object.freeze(record)
  }

  /** Проверяет имя атрибута по обязательному списку sensitive fragments. */
  private _isSensitiveKey(key: string): boolean {
    const normalized = key.toLowerCase()
    return SENSITIVE_ATTRIBUTE_PARTS.some(part => normalized.includes(part))
  }

  /** Нормализует instrumentation scope и гарантирует непустое имя. */
  private _normalizeScope(scope: DiagnosticsInstrumentationScope | undefined): DiagnosticsInstrumentationScope {
    const name = this._normalizeText(scope?.name) || DEFAULT_SCOPE.name
    const version = this._normalizeText(scope?.version)
    return { name, ...(version ? { version } : {}) }
  }

  /** Нормализует correlation и отбрасывает невалидные W3C ids. */
  private _normalizeCorrelation(input: DiagnosticsLogOptions): Pick<DiagnosticsLogRecord, 'traceId' | 'spanId' | 'traceFlags'> {
    const traceId = this._normalizeTraceId(input.traceId)
    const spanId = traceId ? this._normalizeSpanId(input.spanId) : undefined
    const traceFlags = traceId ? this._normalizeTraceFlags(input.traceFlags) : undefined
    return {
      ...(traceId ? { traceId } : {}),
      ...(spanId ? { spanId } : {}),
      ...(traceFlags != null ? { traceFlags } : {}),
    }
  }

  /** Проверяет 16-byte trace id в lowercase hexadecimal representation. */
  private _normalizeTraceId(value: string | undefined): string | undefined {
    const normalized = this._normalizeText(value).toLowerCase()
    return /^[0-9a-f]{32}$/.test(normalized) && !/^0+$/.test(normalized) ? normalized : undefined
  }

  /** Проверяет 8-byte span id в lowercase hexadecimal representation. */
  private _normalizeSpanId(value: string | undefined): string | undefined {
    const normalized = this._normalizeText(value).toLowerCase()
    return /^[0-9a-f]{16}$/.test(normalized) && !/^0+$/.test(normalized) ? normalized : undefined
  }

  /** Нормализует W3C trace flags до одного unsigned byte. */
  private _normalizeTraceFlags(value: number | undefined): number | undefined {
    if (value == null || !Number.isFinite(value))
      return undefined
    return Math.max(0, Math.min(255, Math.floor(value)))
  }

  /** Нормализует timestamp и использует текущее время для отсутствующего значения. */
  private _normalizeTimestamp(value: number | undefined): number {
    return value != null && Number.isFinite(value) ? Math.max(0, value) : Date.now()
  }

  /** Нормализует unknown exception в безопасные строковые поля. */
  private _normalizeException(error: unknown): { type: string, message: string, stacktrace?: string } {
    if (error instanceof Error) {
      return {
        type: this._normalizeText(error.name) || 'Error',
        message: this._normalizeText(error.message) || String(error),
        ...(this._normalizeText(error.stack) ? { stacktrace: this._normalizeText(error.stack) } : {}),
      }
    }
    return { type: typeof error, message: this._normalizeText(error) || 'Unknown exception' }
  }

  /** Возвращает ближайшее поддерживаемое базовое severity value. */
  private _normalizeSeverity(value: number): DiagnosticsSeverityNumber {
    if (value >= 21) return 21
    if (value >= 17) return 17
    if (value >= 13) return 13
    if (value >= 9) return 9
    if (value >= 5) return 5
    return 1
  }

  /** Создаёт новый монотонный id внутри session. */
  private _nextRecordId(): number {
    this._recordId += 1
    return this._recordId
  }

  /** Создаёт session id без зависимости от browser-only API. */
  private _createSessionId(): string {
    return `diag-${this._randomHex(16)}`
  }

  /** Создаёт hexadecimal id указанной длины. */
  private _randomHex(length: number): string {
    const bytes = new Uint8Array(Math.ceil(length / 2))
    if (globalThis.crypto?.getRandomValues)
      globalThis.crypto.getRandomValues(bytes)
    else
      bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256) })
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, length)
  }

  /** Клонирует configuration без передачи mutable ссылок наружу. */
  private _cloneConfiguration(configuration: Readonly<EndgeDiagnosticsConfiguration>): EndgeDiagnosticsConfiguration {
    return JSON.parse(JSON.stringify(configuration)) as EndgeDiagnosticsConfiguration
  }

  /** Нормализует optional text. */
  private _normalizeText(value: unknown): string {
    return String(value ?? '').trim()
  }

  /** Объединяет частые notify в один microtask. */
  private _scheduleNotify(): void {
    if (this._notifyScheduled)
      return
    this._notifyScheduled = true
    queueMicrotask(() => {
      this._notifyScheduled = false
      this.notify()
    })
  }
}
