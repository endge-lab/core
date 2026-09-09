import type { EndgeBootContext } from '@/features/core/kernel/types/bootstrap.types'
import type { DiagnosticsSnapshotRuntimeAdapter } from '@/features/core/modules/diagnostics/domain/types/diagnostics-snapshot-runtime-adapter.type'
import type {
  DiagnosticsRecord,
  DiagnosticsSnapshot,
  DiagnosticsSnapshotCaptureError,
  DiagnosticsSnapshotOptions,
  EndgeDiagnosticsSnapshotContentConfiguration,
} from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'
import type { EndgeProblems_Module } from '@/features/core/modules/diagnostics/EndgeProblems_Module'
import type { EndgeTelemetry_Module } from '@/features/core/modules/diagnostics/EndgeTelemetry_Module'
import type {
  EndgeFederationDiagnosticsSnapshot,
  EndgeFederationDiagnosticsSnapshotOptions,
  EndgeModuleDiagnosticsSnapshotNode,
} from '@/features/federation/types/federation.types'
import { Endge } from '@/features/core/kernel/endge'
import { BrowserDiagnosticsSnapshot_Adapter } from '@/features/core/modules/diagnostics/adapters/BrowserDiagnosticsSnapshot_Adapter'
import { DEFAULT_ENDGE_DIAGNOSTICS_CONFIGURATION } from '@/features/core/modules/diagnostics/config/diagnostics.config'
import { serializeDiagnosticsJson } from '@/features/core/modules/diagnostics/domain/diagnostics-snapshot'
import { ComponentSFCInteractionTriggerActivationMatcher, hasComponentSFCInteractionTriggerActivation, normalizeComponentSFCInteractionTriggerActivation } from '@/features/core/modules/domain/component/component-sfc-edit-trigger'
import { EndgeModule } from '@/features/federation/EndgeModule'

/** Владелец создания, доставки, скачивания и trigger policies диагностических snapshots. */
export class EndgeDiagnosticsSnapshots_Module extends EndgeModule<EndgeBootContext> {
  private _automaticErrorTimestamps: number[] = []
  private _automaticCooldownUntil = 0
  private _unsubscribeAutomaticRecords: (() => void) | null = null
  private _unsubscribeShortcut: (() => void) | null = null
  private _shortcutMatcher: ComponentSFCInteractionTriggerActivationMatcher | null = null
  private _started = false

  /** Создаёт snapshots owner поверх telemetry, problems и platform adapter. */
  public constructor(
    private readonly _telemetry: EndgeTelemetry_Module,
    private readonly _problems: EndgeProblems_Module,
    private readonly _runtimeAdapter: DiagnosticsSnapshotRuntimeAdapter = new BrowserDiagnosticsSnapshot_Adapter(),
  ) {
    super()
    this._subscribeAutomaticSnapshots()
  }

  /** Восстанавливает internal policy subscriptions после telemetry build/reset. */
  public override build(_ctx: EndgeBootContext): void {
    this.configure()
  }

  /** Включает глобальную shortcut subscription только в live lifecycle. */
  public override start(_ctx: EndgeBootContext): void {
    this._started = true
    this._syncShortcutSubscription()
  }

  /** Освобождает live subscriptions и transient policy state. */
  public override reset(): void {
    this._started = false
    this._unsubscribeShortcut?.()
    this._unsubscribeShortcut = null
    this._unsubscribeAutomaticRecords?.()
    this._unsubscribeAutomaticRecords = null
    this._automaticErrorTimestamps = []
    this._automaticCooldownUntil = 0
    this._shortcutMatcher?.reset()
    this._shortcutMatcher = null
  }

  /** Синхронизирует subscriptions после применения новой effective configuration. */
  public configure(): void {
    this._automaticErrorTimestamps = []
    this._automaticCooldownUntil = 0
    this._subscribeAutomaticSnapshots()
    this._syncShortcutSubscription()
  }

  /** Возвращает JSON-safe snapshot выбранных частей текущего состояния Core. */
  public snapshot(options: DiagnosticsSnapshotOptions = {}): DiagnosticsSnapshot {
    const content = this._telemetry.configuration.snapshots.content
    const includeTelemetry = options.includeTelemetry ?? content.telemetry
    const includeProblems = options.includeProblems ?? content.problems
    const includeConfiguration = options.includeConfiguration ?? content.configuration
    const defaults = DEFAULT_ENDGE_DIAGNOSTICS_CONFIGURATION.snapshots.content
    const includeEffectiveConfiguration = options.includeEffectiveConfiguration
      ?? content.effectiveConfiguration
      ?? defaults.effectiveConfiguration
      ?? false
    const includeDomain = options.includeDomain ?? content.domain ?? defaults.domain ?? false
    const includeProgram = options.includeProgram ?? content.program ?? defaults.program ?? false
    const includeRuntime = options.includeRuntime ?? content.runtime ?? defaults.runtime ?? false
    const includeRaphData = options.includeRaphData ?? content.raphData ?? defaults.raphData ?? false
    const includeRaphGraph = options.includeRaphGraph ?? content.raphGraph ?? defaults.raphGraph ?? false
    const captureErrors: DiagnosticsSnapshotCaptureError[] = []
    const federation = this._captureSection(
      'federation',
      () => Endge.createDiagnosticsSnapshot(this._federationOptions({
        effectiveConfiguration: includeEffectiveConfiguration,
        domain: includeDomain,
        program: includeProgram,
        runtime: includeRuntime,
      })),
      captureErrors,
    ) as EndgeFederationDiagnosticsSnapshot | null
    const ownerSections = this._federationOwnerSections(federation, {
      effectiveConfiguration: includeEffectiveConfiguration,
      domain: includeDomain,
      program: includeProgram,
      runtime: includeRuntime,
    }, captureErrors)

    if (federation) {
      this._referenceDiagnosticsModule(federation)
    }
    const rawSnapshot: Record<string, unknown> = {
      format: 'endge-diagnostics-snapshot',
      version: 2,
      generatedAt: Date.now(),
      trigger: options.trigger ?? 'manual',
      ...(includeTelemetry ? { telemetry: this._telemetry.snapshot(options.filter) } : {}),
      ...(includeProblems ? { problems: this._problems.snapshot() } : {}),
      ...(includeConfiguration ? { configuration: this._telemetry.configuration } : {}),
      ...ownerSections,
      federation,
      ...(includeRaphData || includeRaphGraph
        ? {
            raph: this._captureSection(
              'raph',
              () => Endge.runtime.snapshotRaph({ includeData: includeRaphData, includeGraph: includeRaphGraph }),
              captureErrors,
            ),
          }
        : {}),
    }
    if (captureErrors.length) {
      rawSnapshot.captureErrors = captureErrors
    }
    const serialized = serializeDiagnosticsJson(rawSnapshot)
    const snapshot = serialized.value as unknown as DiagnosticsSnapshot
    snapshot.redaction = { applied: true, fields: serialized.redactedFields }
    return snapshot
  }

  /** Создаёт snapshot и доставляет его в выбранные configured outputs. */
  public sendSnapshot(outputIds?: readonly string[], options: DiagnosticsSnapshotOptions = {}): DiagnosticsSnapshot {
    const snapshot = this.snapshot(options)
    const targets = outputIds ?? this._telemetry.configuration.snapshots.automatic.outputIds
    this._telemetry.deliverSnapshot(snapshot, targets)
    return snapshot
  }

  /** Создаёт snapshot и сохраняет его platform adapter-ом в JSON-файл. */
  public downloadSnapshot(options: DiagnosticsSnapshotOptions = {}): DiagnosticsSnapshot {
    const snapshot = this.snapshot(options)
    this._runtimeAdapter.downloadJson(snapshot)
    return snapshot
  }

  /** Восстанавливает внутреннюю подписку на ERROR/FATAL records после configure. */
  private _subscribeAutomaticSnapshots(): void {
    this._unsubscribeAutomaticRecords?.()
    this._unsubscribeAutomaticRecords = this._telemetry.subscribe(
      { signals: ['log'], minSeverity: 17 },
      record => this._handleAutomaticSnapshotRecord(record),
    )
  }

  /** Пересоздаёт live shortcut subscription по effective trigger activation. */
  private _syncShortcutSubscription(): void {
    this._unsubscribeShortcut?.()
    this._unsubscribeShortcut = null
    this._shortcutMatcher?.reset()
    this._shortcutMatcher = null
    if (!this._started) {
      return
    }
    const activation = normalizeComponentSFCInteractionTriggerActivation(
      this._telemetry.configuration.snapshots.shortcut.triggerSet,
    )
    if (!hasComponentSFCInteractionTriggerActivation(activation)) {
      return
    }
    this._shortcutMatcher = new ComponentSFCInteractionTriggerActivationMatcher(activation)
    this._unsubscribeShortcut = this._runtimeAdapter.subscribeShortcut((event) => {
      const match = this._shortcutMatcher?.match(event.type, event.occurrence, event.platform)
      if (!match || match.status === 'none') {
        return
      }
      if (match.trigger.prevent) {
        event.preventDefault()
      }
      if (match.trigger.stop) {
        event.stopPropagation()
      }
      if (match.status !== 'complete') {
        return
      }
      this.downloadSnapshot(this._snapshotOptions(
        this._telemetry.configuration.snapshots.shortcut.content,
        'shortcut',
      ))
    })
  }

  /** Читает одну часть snapshot из её state owner и локализует возможный сбой. */
  private _captureSection(
    section: DiagnosticsSnapshotCaptureError['section'],
    capture: () => unknown,
    errors: DiagnosticsSnapshotCaptureError[],
  ): unknown {
    try {
      return capture()
    }
    catch (error) {
      errors.push({ section, message: error instanceof Error ? error.message : String(error) })
      return null
    }
  }

  /** Сохраняет прежние top-level поля, получая их из нового дерева владельцев. */
  private _federationOwnerSections(
    federation: EndgeFederationDiagnosticsSnapshot | null,
    content: Pick<
      EndgeDiagnosticsSnapshotContentConfiguration,
      'effectiveConfiguration' | 'domain' | 'program' | 'runtime'
    >,
    errors: DiagnosticsSnapshotCaptureError[],
  ): Record<string, unknown> {
    return {
      ...(content.effectiveConfiguration
        ? { effectiveConfiguration: this._takeModuleSnapshot(federation, 'configuration', 'effectiveConfiguration', errors) }
        : {}),
      ...(content.domain
        ? { domain: this._takeModuleSnapshot(federation, 'domain', 'domain', errors) }
        : {}),
      ...(content.program
        ? { program: this._takeModuleSnapshot(federation, 'program', 'program', errors) }
        : {}),
      ...(content.runtime
        ? { runtime: this._takeModuleSnapshot(federation, 'runtime', 'runtime', errors) }
        : {}),
    }
  }

  /** Применяет существующие content toggles к тяжёлым Core Modules до чтения их состояния. */
  private _federationOptions(
    content: Pick<
      EndgeDiagnosticsSnapshotContentConfiguration,
      'effectiveConfiguration' | 'domain' | 'program' | 'runtime'
    >,
  ): EndgeFederationDiagnosticsSnapshotOptions {
    return {
      shouldCaptureModule: ({ federationId, key }) => {
        if (federationId !== 'endge') {
          return true
        }
        if (key === 'diagnostics') {
          return false
        }
        if (key === 'configuration') {
          return content.effectiveConfiguration !== false
        }
        if (key === 'domain') {
          return content.domain !== false
        }
        if (key === 'program') {
          return content.program !== false
        }
        if (key === 'runtime') {
          return content.runtime !== false
        }
        return true
      },
    }
  }

  /** Переносит snapshot Core Module в совместимое top-level поле без повторного сбора. */
  private _takeModuleSnapshot(
    federation: EndgeFederationDiagnosticsSnapshot | null,
    key: string,
    section: DiagnosticsSnapshotCaptureError['section'],
    errors: DiagnosticsSnapshotCaptureError[],
  ): unknown {
    const node = federation?.nodes.find(
      (candidate): candidate is EndgeModuleDiagnosticsSnapshotNode =>
        candidate.kind === 'module' && candidate.key === key,
    )
    if (!node) {
      errors.push({ section, message: `Module "${key}" is absent from the federation snapshot` })
      return null
    }
    if (node.status === 'failed') {
      errors.push({ section, message: node.error ?? `Module "${key}" snapshot failed` })
      return null
    }
    if (node.status !== 'captured') {
      errors.push({ section, message: `Module "${key}" returned no diagnostic snapshot` })
      return null
    }

    const snapshot = node.snapshot
    delete node.snapshot
    node.status = 'referenced'
    node.snapshotRef = `#/${section}`
    return snapshot
  }

  /** Показывает, что состояние Diagnostics Module представлено корневыми полями файла. */
  private _referenceDiagnosticsModule(federation: EndgeFederationDiagnosticsSnapshot): void {
    const node = federation.nodes.find(
      (candidate): candidate is EndgeModuleDiagnosticsSnapshotNode =>
        candidate.kind === 'module' && candidate.key === 'diagnostics',
    )
    if (!node) {
      return
    }
    node.status = 'referenced'
    node.snapshotRef = '#/'
  }

  /** Применяет sliding window и cooldown политики автоматического snapshot. */
  private _handleAutomaticSnapshotRecord(record: DiagnosticsRecord): void {
    if (record.signal !== 'log') {
      return
    }
    const policy = this._telemetry.configuration.snapshots.automatic
    if (!policy.enabled) {
      return
    }
    const now = record.timestamp
    if (now < this._automaticCooldownUntil) {
      return
    }
    const windowStart = now - policy.windowSeconds * 1_000
    this._automaticErrorTimestamps = this._automaticErrorTimestamps.filter(timestamp => timestamp >= windowStart)
    this._automaticErrorTimestamps.push(now)
    if (this._automaticErrorTimestamps.length < policy.errorCount) {
      return
    }
    this._automaticErrorTimestamps = []
    this._automaticCooldownUntil = now + policy.cooldownSeconds * 1_000
    this.sendSnapshot(policy.outputIds, { trigger: 'automatic' })
  }

  /** Переводит persisted content policy в публичные snapshot options. */
  private _snapshotOptions(
    content: EndgeDiagnosticsSnapshotContentConfiguration,
    trigger: NonNullable<DiagnosticsSnapshotOptions['trigger']>,
  ): DiagnosticsSnapshotOptions {
    return {
      trigger,
      includeTelemetry: content.telemetry,
      includeProblems: content.problems,
      includeConfiguration: content.configuration,
      includeEffectiveConfiguration: content.effectiveConfiguration,
      includeDomain: content.domain,
      includeProgram: content.program,
      includeRuntime: content.runtime,
      includeRaphData: content.raphData,
      includeRaphGraph: content.raphGraph,
    }
  }
}
