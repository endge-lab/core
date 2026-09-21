import type { EndgeBootContext } from '@/features/core/kernel/types/bootstrap.types'
import type {
  DiagnosticsAdapter,
  DiagnosticsAdapterFactory,
  DiagnosticsFlushResult,
} from '@/features/core/modules/diagnostics/domain/types/diagnostics-adapter.type'
import type {
  DiagnosticsContextProvider,
  DiagnosticsExceptionOptions,
  DiagnosticsFilter,
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
} from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'
import { CONSOLE_DIAGNOSTICS_ADAPTER_FACTORY } from '@/features/core/modules/diagnostics/adapters/ConsoleDiagnosticsAdapter'
import { DiagnosticsAdapterRegistry } from '@/features/core/modules/diagnostics/adapters/DiagnosticsAdapterRegistry'
import { SENTRY_DIAGNOSTICS_ADAPTER_FACTORY } from '@/features/core/modules/diagnostics/adapters/SentryDiagnosticsAdapter'
import { EndgeDiagnosticsSnapshots_Module } from '@/features/core/modules/diagnostics/EndgeDiagnosticsSnapshots_Module'
import { EndgeProblems_Module } from '@/features/core/modules/diagnostics/EndgeProblems_Module'
import { EndgeTelemetry_Module } from '@/features/core/modules/diagnostics/EndgeTelemetry_Module'
import { EndgeModule } from '@/features/federation/EndgeModule'

/**
 * Родительский diagnostics-модуль ядра.
 * Объединяет telemetry history, актуальные problems и lifecycle snapshots policy.
 */
export class EndgeDiagnostics_Module extends EndgeModule<EndgeBootContext> {
  /** Registry системных и внешних adapter factories. */
  public readonly adapters: DiagnosticsAdapterRegistry

  /** Подмодуль logs, traces, adapters и external delivery. */
  public readonly telemetry: EndgeTelemetry_Module

  /** Подмодуль актуальных authoring/build/runtime problems. */
  public readonly problems: EndgeProblems_Module

  /** Подмодуль создания, доставки и browser download диагностических snapshots. */
  public readonly snapshots: EndgeDiagnosticsSnapshots_Module

  /**
   * ----------------------------------------
   * PUBLIC
   * ----------------------------------------
   */

  /** Связывает независимые уведомления подмодулей с родительским diagnostics-модулем. */
  public constructor() {
    super()
    this.adapters = new DiagnosticsAdapterRegistry()
    this.adapters.register(CONSOLE_DIAGNOSTICS_ADAPTER_FACTORY)
    this.adapters.register(SENTRY_DIAGNOSTICS_ADAPTER_FACTORY)
    this.telemetry = new EndgeTelemetry_Module(this.adapters)
    this.problems = new EndgeProblems_Module()
    this.snapshots = new EndgeDiagnosticsSnapshots_Module(this.telemetry, this.problems)
    this.telemetry.subscribe(() => this.notify())
    this.problems.subscribe(() => this.notify())
  }

  /** Передаёт setup lifecycle подмодулям в порядке их зависимостей. */
  public override async setup(ctx: EndgeBootContext): Promise<void> {
    await this.telemetry.setup(ctx)
    await this.problems.setup(ctx)
    await this.snapshots.setup(ctx)
  }

  /** Передаёт load lifecycle подмодулям в порядке их зависимостей. */
  public override async load(ctx: EndgeBootContext): Promise<void> {
    await this.telemetry.load(ctx)
    await this.problems.load(ctx)
    await this.snapshots.load(ctx)
  }

  /** Передаёт build lifecycle подмодулям в порядке их зависимостей. */
  public override async build(ctx: EndgeBootContext): Promise<void> {
    await this.telemetry.build(ctx)
    await this.problems.build(ctx)
    await this.snapshots.build(ctx)
  }

  /** Передаёт start lifecycle подмодулям в порядке их зависимостей. */
  public override async start(ctx: EndgeBootContext): Promise<void> {
    await this.telemetry.start(ctx)
    await this.problems.start(ctx)
    await this.snapshots.start(ctx)
  }

  /** Сбрасывает подмодули в обратном порядке их запуска. */
  public override async reset(): Promise<void> {
    await this.snapshots.reset()
    await this.problems.reset()
    await this.telemetry.reset()
  }

  /** Применяет telemetry, outputs, routes и snapshots configuration. */
  public configure(configuration: EndgeDiagnosticsConfiguration, resource: DiagnosticsResource = this.telemetry.resource): void {
    this.telemetry.configure(configuration, resource)
    this.snapshots.configure()
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
  public finishSpan(input: Parameters<EndgeTelemetry_Module['finishSpan']>[0]): DiagnosticsSpanRecord | null {
    return this.telemetry.finishSpan(input)
  }

  /** Подписывает listener на любое изменение родительского diagnostics-модуля. */
  public override subscribe(listener: () => void): () => void

  /** Подписывает listener на отфильтрованный telemetry stream. */
  public subscribe(filter: DiagnosticsFilter, listener: DiagnosticsListener, options?: DiagnosticsSubscribeOptions): () => void

  /** Реализует общую и telemetry record subscriptions. */
  public subscribe(
    filterOrListener: DiagnosticsFilter | (() => void),
    listener?: DiagnosticsListener,
    options: DiagnosticsSubscribeOptions = {},
  ): () => void {
    if (typeof filterOrListener === 'function') {
      return super.subscribe(filterOrListener)
    }
    if (!listener) {
      throw new Error('[EndgeDiagnostics] Record listener is required')
    }
    return this.telemetry.subscribe(filterOrListener, listener, options)
  }

  /** Возвращает telemetry records, соответствующие фильтру. */
  public query(filter: DiagnosticsFilter = {}): readonly DiagnosticsRecord[] {
    return this.telemetry.query(filter)
  }

  /** Возвращает JSON-safe snapshot telemetry, problems и optional configuration. */
  public snapshot(options: DiagnosticsSnapshotOptions = {}): DiagnosticsSnapshot {
    return this.snapshots.snapshot(options)
  }

  /** Включает snapshots собственных submodules без рекурсивного запуска общего сборщика. */
  public override createDiagnosticsSnapshot(): unknown {
    return {
      telemetry: this.telemetry.snapshot(),
      problems: this.problems.snapshot(),
      configuration: this.configuration,
    }
  }

  /** Создаёт snapshot и доставляет его в выбранные configured outputs. */
  public sendSnapshot(outputIds?: readonly string[], options: DiagnosticsSnapshotOptions = {}): DiagnosticsSnapshot {
    return this.snapshots.sendSnapshot(outputIds, options)
  }

  /** Создаёт snapshot и сохраняет его в JSON-файл через platform adapter. */
  public downloadSnapshot(options: DiagnosticsSnapshotOptions = {}): DiagnosticsSnapshot {
    return this.snapshots.downloadSnapshot(options)
  }

  /** Возвращает telemetry counters текущей session. */
  public getCounters(): ReturnType<EndgeTelemetry_Module['getCounters']> {
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

  /**
   * ----------------------------------------
   * ACCESS
   * ----------------------------------------
   */

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
}
