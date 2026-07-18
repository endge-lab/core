import type { EndgeBootContext } from '@/domain/types/kernel/bootstrap.types'
import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import type {
  DiagnosticsAdapter,
  DiagnosticsAdapterFactory,
  DiagnosticsContextProvider,
  DiagnosticsExceptionOptions,
  DiagnosticsFilter,
  DiagnosticsFlushResult,
  DiagnosticsListener,
  DiagnosticsLogInput,
  DiagnosticsLogOptions,
  DiagnosticsLogRecord,
  DiagnosticsRecord,
  DiagnosticsResource,
  DiagnosticsSnapshot,
  DiagnosticsSnapshotOptions,
  DiagnosticsSpanHandle,
  DiagnosticsSpanOptions,
  DiagnosticsSpanRecord,
  DiagnosticsSubscribeOptions,
  EndgeDiagnosticsConfiguration,
} from '@/domain/types/diagnostics'
import {
  CONSOLE_DIAGNOSTICS_ADAPTER_FACTORY,
  DiagnosticsAdapterRegistry,
} from '@/model/adapters/diagnostics'
import { EndgeProblems } from '@/model/endge/diagnostics/endge-problems'
import { EndgeTelemetry } from '@/model/endge/diagnostics/endge-telemetry'

/**
 * Единый diagnostics facade ядра.
 * Объединяет append-only telemetry history и replaceable registry актуальных problems.
 */
export class EndgeDiagnostics extends EndgeModule {
  /** Registry системных и внешних adapter factories. */
  public readonly adapters: DiagnosticsAdapterRegistry

  /** Подмодуль logs, traces, adapters и external delivery. */
  public readonly telemetry: EndgeTelemetry

  /** Подмодуль актуальных authoring/build/runtime problems. */
  public readonly problems: EndgeProblems

  private _automaticErrorTimestamps: number[] = []
  private _automaticCooldownUntil = 0
  private _unsubscribeAutomaticRecords: (() => void) | null = null

  /** Связывает независимые уведомления подмодулей с общим diagnostics facade. */
  public constructor() {
    super()
    this.adapters = new DiagnosticsAdapterRegistry()
    this.adapters.register(CONSOLE_DIAGNOSTICS_ADAPTER_FACTORY)
    this.telemetry = new EndgeTelemetry(this.adapters)
    this.problems = new EndgeProblems()
    this.telemetry.subscribe(() => this.notify())
    this.problems.subscribe(() => this.notify())
    this._subscribeAutomaticSnapshots()
  }

  /** Возвращает идентификатор текущей telemetry session. */
  public get sessionId(): string {
    return this.telemetry.sessionId
  }

  /** Возвращает effective telemetry configuration. */
  public get configuration(): EndgeDiagnosticsConfiguration {
    return this.telemetry.configuration
  }

  /** Возвращает resource текущей telemetry session. */
  public get resource(): DiagnosticsResource {
    return this.telemetry.resource
  }

  /** Применяет effective diagnostics configuration в build lifecycle. */
  public override build(ctx: EndgeBootContext): void {
    this.telemetry.build(ctx)
  }

  /** Сбрасывает оба diagnostics submodules для следующего boot lifecycle. */
  public override async reset(): Promise<void> {
    await this.telemetry.reset()
    this.problems.reset()
    this._automaticErrorTimestamps = []
    this._automaticCooldownUntil = 0
    this._subscribeAutomaticSnapshots()
  }

  /** Применяет telemetry, outputs, routes и snapshots configuration. */
  public configure(configuration: EndgeDiagnosticsConfiguration, resource: DiagnosticsResource = this.telemetry.resource): void {
    this._automaticErrorTimestamps = []
    this._automaticCooldownUntil = 0
    this.telemetry.configure(configuration, resource)
  }

  /** Записывает один structured log через telemetry-подмодуль. */
  public log(input: DiagnosticsLogInput): DiagnosticsLogRecord | null {
    return this.telemetry.log(input)
  }

  /** Записывает log уровня TRACE. */
  public trace(body: string, options: DiagnosticsLogOptions = {}): DiagnosticsLogRecord | null {
    return this.telemetry.trace(body, options)
  }

  /** Записывает log уровня DEBUG. */
  public debug(body: string, options: DiagnosticsLogOptions = {}): DiagnosticsLogRecord | null {
    return this.telemetry.debug(body, options)
  }

  /** Записывает log уровня INFO. */
  public info(body: string, options: DiagnosticsLogOptions = {}): DiagnosticsLogRecord | null {
    return this.telemetry.info(body, options)
  }

  /** Записывает log уровня WARN. */
  public warn(body: string, options: DiagnosticsLogOptions = {}): DiagnosticsLogRecord | null {
    return this.telemetry.warn(body, options)
  }

  /** Записывает log уровня ERROR. */
  public error(body: string, options: DiagnosticsLogOptions = {}): DiagnosticsLogRecord | null {
    return this.telemetry.error(body, options)
  }

  /** Записывает log уровня FATAL без автоматической остановки runtime. */
  public fatal(body: string, options: DiagnosticsLogOptions = {}): DiagnosticsLogRecord | null {
    return this.telemetry.fatal(body, options)
  }

  /** Нормализует exception и записывает его в telemetry history. */
  public recordException(error: unknown, options: DiagnosticsExceptionOptions = {}): DiagnosticsLogRecord | null {
    return this.telemetry.recordException(error, options)
  }

  /** Создаёт root или child span через telemetry-подмодуль. */
  public startSpan(name: string, options: DiagnosticsSpanOptions = {}): DiagnosticsSpanHandle {
    return this.telemetry.startSpan(name, options)
  }

  /** Завершает span, созданный через низкоуровневый DiagnosticsSpanOwner contract. */
  public finishSpan(input: Parameters<EndgeTelemetry['finishSpan']>[0]): DiagnosticsSpanRecord | null {
    return this.telemetry.finishSpan(input)
  }

  /** Подписывает listener на любое изменение diagnostics facade. */
  public override subscribe(listener: () => void): () => void

  /** Подписывает listener на отфильтрованный telemetry stream. */
  public subscribe(filter: DiagnosticsFilter, listener: DiagnosticsListener, options?: DiagnosticsSubscribeOptions): () => void

  /** Реализует facade-level и telemetry record subscriptions. */
  public subscribe(
    filterOrListener: DiagnosticsFilter | (() => void),
    listener?: DiagnosticsListener,
    options: DiagnosticsSubscribeOptions = {},
  ): () => void {
    if (typeof filterOrListener === 'function')
      return super.subscribe(filterOrListener)
    if (!listener)
      throw new Error('[EndgeDiagnostics] Record listener is required')
    return this.telemetry.subscribe(filterOrListener, listener, options)
  }

  /** Возвращает telemetry records, соответствующие фильтру. */
  public query(filter: DiagnosticsFilter = {}): readonly DiagnosticsRecord[] {
    return this.telemetry.query(filter)
  }

  /** Возвращает JSON-safe snapshot telemetry, problems и optional configuration. */
  public snapshot(options: DiagnosticsSnapshotOptions = {}): DiagnosticsSnapshot {
    const content = this.configuration.snapshots.content
    const includeTelemetry = options.includeTelemetry ?? content.telemetry
    const includeProblems = options.includeProblems ?? content.problems
    const includeConfiguration = options.includeConfiguration ?? content.configuration
    return {
      generatedAt: Date.now(),
      trigger: options.trigger ?? 'manual',
      ...(includeTelemetry ? { telemetry: this.telemetry.snapshot(options.filter) } : {}),
      ...(includeProblems ? { problems: this.problems.snapshot() } : {}),
      ...(includeConfiguration ? { configuration: this.configuration } : {}),
    }
  }

  /** Создаёт snapshot и доставляет его в выбранные configured outputs. */
  public sendSnapshot(outputIds?: readonly string[], options: DiagnosticsSnapshotOptions = {}): DiagnosticsSnapshot {
    const snapshot = this.snapshot(options)
    const targets = outputIds ?? this.configuration.snapshots.automatic.outputIds
    this.telemetry.deliverSnapshot(snapshot, targets)
    return snapshot
  }

  /** Возвращает telemetry counters текущей session. */
  public getCounters(): ReturnType<EndgeTelemetry['getCounters']> {
    return this.telemetry.getCounters()
  }

  /** Очищает только telemetry history, не затрагивая актуальные problems. */
  public clear(): void {
    this.telemetry.clear()
  }

  /** Регистрирует provider общих telemetry attributes. */
  public registerContextProvider(id: string, provider: DiagnosticsContextProvider): () => void {
    return this.telemetry.registerContextProvider(id, provider)
  }

  /** Регистрирует adapter внешней telemetry delivery. */
  public registerAdapter(adapter: DiagnosticsAdapter): () => void {
    return this.telemetry.registerAdapter(adapter)
  }

  /** Регистрирует внешний тип adapter и возвращает функцию удаления factory. */
  public registerAdapterFactory(factory: DiagnosticsAdapterFactory): () => void {
    return this.adapters.register(factory)
  }

  /** Проверяет configured output через созданный runtime adapter. */
  public testOutput(outputId: string): Promise<boolean> {
    return this.telemetry.testOutput(outputId)
  }

  /** Отключает telemetry adapter и освобождает его ресурсы. */
  public unregisterAdapter(adapterId: string): Promise<void> {
    return this.telemetry.unregisterAdapter(adapterId)
  }

  /** Выполняет best-effort flush всех telemetry adapters. */
  public flush(): Promise<DiagnosticsFlushResult> {
    return this.telemetry.flush()
  }

  /** Восстанавливает внутреннюю подписку на ERROR/FATAL records после reset. */
  private _subscribeAutomaticSnapshots(): void {
    this._unsubscribeAutomaticRecords?.()
    this._unsubscribeAutomaticRecords = this.telemetry.subscribe(
      { signals: ['log'], minSeverity: 17 },
      record => this._handleAutomaticSnapshotRecord(record),
    )
  }

  /** Применяет sliding window и cooldown политики автоматического snapshot. */
  private _handleAutomaticSnapshotRecord(record: DiagnosticsRecord): void {
    if (record.signal !== 'log')
      return
    const policy = this.configuration.snapshots.automatic
    if (!policy.enabled)
      return

    const now = record.timestamp
    if (now < this._automaticCooldownUntil)
      return

    const windowStart = now - policy.windowSeconds * 1_000
    this._automaticErrorTimestamps = this._automaticErrorTimestamps.filter(timestamp => timestamp >= windowStart)
    this._automaticErrorTimestamps.push(now)
    if (this._automaticErrorTimestamps.length < policy.errorCount)
      return

    this._automaticErrorTimestamps = []
    this._automaticCooldownUntil = now + policy.cooldownSeconds * 1_000
    this.sendSnapshot(policy.outputIds, { trigger: 'automatic' })
  }
}
