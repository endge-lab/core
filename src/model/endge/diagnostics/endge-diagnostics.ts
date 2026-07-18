import type { EndgeBootContext } from '@/domain/types/kernel/bootstrap.types'
import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import type {
  DiagnosticsAdapter,
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
import { EndgeProblems } from '@/model/endge/diagnostics/endge-problems'
import { EndgeTelemetry } from '@/model/endge/diagnostics/endge-telemetry'

/**
 * Единый diagnostics facade ядра.
 * Объединяет append-only telemetry history и replaceable registry актуальных problems.
 */
export class EndgeDiagnostics extends EndgeModule {
  /** Подмодуль logs, traces, adapters и external delivery. */
  public readonly telemetry = new EndgeTelemetry()

  /** Подмодуль актуальных authoring/build/runtime problems. */
  public readonly problems = new EndgeProblems()

  /** Связывает независимые уведомления подмодулей с общим diagnostics facade. */
  public constructor() {
    super()
    this.telemetry.subscribe(() => this.notify())
    this.problems.subscribe(() => this.notify())
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
  }

  /** Применяет collection/routes configuration к telemetry-подмодулю. */
  public configure(configuration: EndgeDiagnosticsConfiguration, resource: DiagnosticsResource = this.telemetry.resource): void {
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

  /** Возвращает snapshot текущей telemetry session. */
  public snapshot(options: DiagnosticsSnapshotOptions = {}): DiagnosticsSnapshot {
    return this.telemetry.snapshot(options)
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

  /** Отключает telemetry adapter и освобождает его ресурсы. */
  public unregisterAdapter(adapterId: string): Promise<void> {
    return this.telemetry.unregisterAdapter(adapterId)
  }

  /** Выполняет best-effort flush всех telemetry adapters. */
  public flush(): Promise<DiagnosticsFlushResult> {
    return this.telemetry.flush()
  }
}
