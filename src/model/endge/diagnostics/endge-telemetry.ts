import type { EndgeBootContext } from '@/domain/types/kernel/bootstrap.types'
import { DiagnosticsRecordStore } from '@/domain/entities/diagnostics/DiagnosticsRecordStore'
import { DiagnosticsSpan } from '@/domain/entities/diagnostics/DiagnosticsSpan'
import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import type {
  DiagnosticsAdapter,
  DiagnosticsAttributes,
  DiagnosticsAttributeValue,
  DiagnosticsCounters,
  DiagnosticsContextProvider,
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
  DiagnosticsTelemetrySnapshot,
  DiagnosticsSpanEndOptions,
  DiagnosticsSpanHandle,
  DiagnosticsSpanOptions,
  DiagnosticsSpanOwner,
  DiagnosticsSpanRecord,
  DiagnosticsSubscribeOptions,
  EndgeDiagnosticsConfiguration,
  EndgeDiagnosticsOutputConfiguration,
} from '@/domain/types/diagnostics'
import { DiagnosticsAdapterRegistry } from '@/model/adapters/diagnostics/DiagnosticsAdapterRegistry'
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
 * Telemetry-подмодуль диагностики Endge.
 * Собирает logs и завершённые spans, хранит bounded session history и маршрутизирует records в adapters.
 */
export class EndgeTelemetry extends EndgeModule implements DiagnosticsSpanOwner {
  private _configuration = this._cloneConfiguration(DEFAULT_ENDGE_DIAGNOSTICS_CONFIGURATION)
  private _resource: DiagnosticsResource = { attributes: { 'service.name': 'endge' } }
  private _store = new DiagnosticsRecordStore(this._configuration.telemetry.collection.maxRecords)
  private readonly _configuredAdapters = new Map<string, DiagnosticsAdapter>()
  private readonly _manualAdapters = new Map<string, DiagnosticsAdapter>()
  private readonly _contextProviders = new Map<string, DiagnosticsContextProvider>()
  private readonly _subscriptions = new Set<DiagnosticsSubscription>()
  private readonly _activeSpans = new Map<string, DiagnosticsSpan>()
  private _sessionId = this._createSessionId()
  private _recordId = 0
  private _droppedByPolicy = 0
  private _droppedByCapacity = 0
  private _adapterFailures = 0
  private _listenerFailures = 0
  private _contextProviderFailures = 0
  private _notifyScheduled = false

  /** Создаёт telemetry module с внешним registry adapter factories. */
  public constructor(private readonly _adapterRegistry: DiagnosticsAdapterRegistry) {
    super()
    this._adapterRegistry.subscribe(() => this._rebuildConfiguredAdapters())
  }

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
      [...this._allAdapters().values()].map(adapter => Promise.resolve().then(() => adapter.dispose?.())),
    )

    this._configuredAdapters.clear()
    this._manualAdapters.clear()
    this._contextProviders.clear()
    this._subscriptions.clear()
    this._activeSpans.clear()
    this._store.clear()
    this._sessionId = this._createSessionId()
    this._recordId = 0
    this._droppedByPolicy = 0
    this._droppedByCapacity = 0
    this._adapterFailures = 0
    this._listenerFailures = 0
    this._contextProviderFailures = 0
    this._scheduleNotify()
  }

  /** Применяет telemetry, outputs и routes configuration без привязки к UI. */
  public configure(configuration: EndgeDiagnosticsConfiguration, resource: DiagnosticsResource = this._resource): void {
    const signals = [...new Set(configuration.telemetry.collection.signals.filter(signal => signal === 'log' || signal === 'span'))]
    this._configuration = {
      telemetry: {
        collection: {
          enabled: configuration.telemetry.collection.enabled !== false,
          signals,
          minSeverity: this._normalizeSeverity(configuration.telemetry.collection.minSeverity),
          maxRecords: Math.max(1, Math.floor(Number(configuration.telemetry.collection.maxRecords) || 2_000)),
        },
        outputs: configuration.telemetry.outputs.map(output => ({
          ...output,
          options: this._cloneAdapterOptions(output.options),
        })),
        routes: configuration.telemetry.routes.map(route => ({
          ...route,
          match: this._cloneFilter(route.match),
        })),
      },
      snapshots: this._cloneConfiguration(configuration).snapshots,
    }
    this._resource = { attributes: this._normalizeAttributes(resource.attributes) }
    this._store.setCapacity(this._configuration.telemetry.collection.maxRecords)
    this._rebuildConfiguredAdapters()
    this._scheduleNotify()
  }

  /** Записывает один нормализованный structured log. */
  public log(input: DiagnosticsLogInput): DiagnosticsLogRecord | null {
    const severityNumber = this._normalizeSeverity(input.severityNumber)
    if (!this._canCollect('log', severityNumber))
      return null

    const attributes = this._resolveRecordAttributes(input.attributes)
    const phase = this._normalizePhase(input.phase ?? attributes['endge.phase'])
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
      attributes,
      ...(phase ? { phase } : {}),
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
    const attributes = this._resolveRecordAttributes(options.attributes)
    const phase = this._normalizePhase(options.phase ?? attributes['endge.phase'])
    const span = new DiagnosticsSpan(
      this,
      traceId,
      spanId,
      parentSpanId,
      this._normalizeTraceFlags(options.traceFlags),
      this._normalizeText(name) || 'span',
      this._normalizeScope(options.scope),
      this._normalizeTimestamp(options.startTimestamp),
      attributes,
      phase,
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
    phase?: 'authoring' | 'build' | 'runtime'
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
      ...(input.phase ? { phase: input.phase } : {}),
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

  /** Возвращает telemetry-часть JSON-safe diagnostics snapshot. */
  public snapshot(filter: DiagnosticsFilter = {}): DiagnosticsTelemetrySnapshot {
    return {
      sessionId: this._sessionId,
      resource: this.resource,
      counters: this.getCounters(),
      records: this.query(filter),
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
      contextProviderFailures: this._contextProviderFailures,
      activeAdapters: this._allAdapters().size,
      activeContextProviders: this._contextProviders.size,
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
    this._contextProviderFailures = 0
    this._scheduleNotify()
  }

  /** Регистрирует синхронный provider общих record attributes и возвращает функцию отключения. */
  public registerContextProvider(id: string, provider: DiagnosticsContextProvider): () => void {
    const normalizedId = this._normalizeText(id)
    if (!normalizedId)
      throw new Error('[EndgeDiagnostics] Context provider id is required')
    if (this._contextProviders.has(normalizedId))
      throw new Error(`[EndgeDiagnostics] Context provider "${normalizedId}" is already registered`)

    this._contextProviders.set(normalizedId, provider)
    this._scheduleNotify()
    return () => {
      if (this._contextProviders.delete(normalizedId))
        this._scheduleNotify()
    }
  }

  /** Регистрирует готовый adapter для программного output и возвращает функцию отключения. */
  public registerAdapter(adapter: DiagnosticsAdapter): () => void {
    const id = this._normalizeText(adapter.id)
    if (!id)
      throw new Error('[EndgeDiagnostics] Adapter id is required')
    if (this._manualAdapters.has(id))
      throw new Error(`[EndgeDiagnostics] Adapter "${id}" is already registered`)

    this._manualAdapters.set(id, adapter)
    this._scheduleNotify()
    return () => { void this.unregisterAdapter(id) }
  }

  /** Доставляет buffered data, освобождает adapter и удаляет его из registry. */
  public async unregisterAdapter(adapterId: string): Promise<void> {
    const id = this._normalizeText(adapterId)
    const adapter = this._manualAdapters.get(id)
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
      this._manualAdapters.delete(id)
      this._scheduleNotify()
    }
  }

  /** Проверяет один configured output через optional adapter test method. */
  public async testOutput(outputId: string): Promise<boolean> {
    const adapter = this._getAdapter(outputId)
    if (!adapter?.test)
      return false
    try {
      await adapter.test()
      return true
    }
    catch {
      this._adapterFailures += 1
      return false
    }
  }

  /** Доставляет snapshot в указанные outputs с поддержкой best-effort semantics. */
  public deliverSnapshot(snapshot: DiagnosticsSnapshot, outputIds: readonly string[]): void {
    for (const outputId of new Set(outputIds)) {
      const adapter = this._getAdapter(outputId)
      const output = this._resolveOutput(outputId)
      if (!adapter?.acceptSnapshot || !output)
        continue
      try {
        const pending = adapter.acceptSnapshot(snapshot, {
          sessionId: this._sessionId,
          resource: this.resource,
          output,
          trigger: snapshot.trigger,
        })
        if (pending)
          void Promise.resolve(pending).catch(() => { this._adapterFailures += 1 })
      }
      catch {
        this._adapterFailures += 1
      }
    }
  }

  /** Выполняет best-effort flush всех adapters без reset модуля. */
  public async flush(): Promise<DiagnosticsFlushResult> {
    const result: DiagnosticsFlushResult = { succeeded: [], failed: [] }
    for (const [outputId, adapter] of this._allAdapters().entries()) {
      try {
        await adapter.flush?.()
        result.succeeded.push(outputId)
      }
      catch (error) {
        this._adapterFailures += 1
        result.failed.push({ outputId, error })
      }
    }
    return result
  }

  /** Проверяет collection policy для signal и optional severity. */
  private _canCollect(signal: DiagnosticsSignal, severity?: DiagnosticsSeverityNumber): boolean {
    const collection = this._configuration.telemetry.collection
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

    const routesByOutput = new Map<string, string[]>()
    for (const route of this._configuration.telemetry.routes) {
      if (route.enabled && this._matchesFilter(immutableRecord, route.match)) {
        const routeIds = routesByOutput.get(route.outputId) ?? []
        routeIds.push(route.id)
        routesByOutput.set(route.outputId, routeIds)
      }
    }
    for (const [outputId, routeIds] of routesByOutput) {
      const adapter = this._getAdapter(outputId)
      const output = this._resolveOutput(outputId)
      if (!adapter || !output)
        continue
      try {
        const pending = adapter.acceptRecord(immutableRecord, {
          sessionId: this._sessionId,
          resource: this.resource,
          routeIds,
          output,
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
    if (filter.phases?.length && (!record.phase || !filter.phases.includes(record.phase)))
      return false
    if (filter.minSeverity != null && record.signal === 'log' && record.severityNumber < filter.minSeverity)
      return false
    if (filter.spanStatuses?.length && (record.signal !== 'span' || !filter.spanStatuses.includes(record.status.code)))
      return false
    if (filter.minDurationMs != null && (record.signal !== 'span' || record.durationMs < filter.minDurationMs))
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

  /** Добавляет к producer attributes значения всех context providers в порядке регистрации. */
  private _resolveRecordAttributes(input: DiagnosticsAttributes | undefined): DiagnosticsAttributes {
    const attributes = this._normalizeAttributes(input)
    for (const provider of this._contextProviders.values()) {
      try {
        Object.assign(attributes, this._normalizeAttributes(provider()))
      }
      catch {
        this._contextProviderFailures += 1
      }
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
      ...(filter.phases ? { phases: [...filter.phases] } : {}),
      ...(filter.spanStatuses ? { spanStatuses: [...filter.spanStatuses] } : {}),
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

  /** Нормализует diagnostics phase из explicit field или legacy endge.phase attribute. */
  private _normalizePhase(value: unknown): 'authoring' | 'build' | 'runtime' | undefined {
    return value === 'authoring' || value === 'build' || value === 'runtime' ? value : undefined
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

  /** Клонирует JSON-safe adapter options. */
  private _cloneAdapterOptions(
    options: EndgeDiagnosticsOutputConfiguration['options'],
  ): EndgeDiagnosticsOutputConfiguration['options'] {
    return JSON.parse(JSON.stringify(options)) as EndgeDiagnosticsOutputConfiguration['options']
  }

  /** Пересоздаёт adapters enabled outputs после configuration или registry changes. */
  private _rebuildConfiguredAdapters(): void {
    for (const adapter of this._configuredAdapters.values())
      void Promise.resolve().then(() => adapter.dispose?.()).catch(() => { this._adapterFailures += 1 })
    this._configuredAdapters.clear()

    for (const output of this._configuration.telemetry.outputs) {
      if (!output.enabled || this._manualAdapters.has(output.id))
        continue
      try {
        const adapter = this._adapterRegistry.create(output, {
          sessionId: this._sessionId,
          resource: this.resource,
        })
        if (adapter)
          this._configuredAdapters.set(output.id, adapter)
      }
      catch {
        this._adapterFailures += 1
      }
    }
    this._scheduleNotify()
  }

  /** Возвращает configured или manual adapter для одного output id. */
  private _getAdapter(outputId: string): DiagnosticsAdapter | undefined {
    return this._manualAdapters.get(outputId) ?? this._configuredAdapters.get(outputId)
  }

  /** Возвращает configured output или synthetic descriptor программного adapter. */
  private _resolveOutput(outputId: string): EndgeDiagnosticsOutputConfiguration | undefined {
    const configured = this._configuration.telemetry.outputs.find(output => output.id === outputId && output.enabled)
    if (configured)
      return configured
    if (this._manualAdapters.has(outputId)) {
      return {
        id: outputId,
        name: outputId,
        enabled: true,
        adapterType: 'manual',
        options: {},
      }
    }
    return undefined
  }

  /** Объединяет adapters для counters и flush, отдавая приоритет manual registration. */
  private _allAdapters(): Map<string, DiagnosticsAdapter> {
    return new Map([...this._configuredAdapters, ...this._manualAdapters])
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
