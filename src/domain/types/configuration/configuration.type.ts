import type { ComponentSFCInteractionTrigger } from '@/domain/types/component/sfc/ir.types'
import type {
  DiagnosticsSeverityNumber,
  DiagnosticsSignal,
  EndgeDiagnosticsOutputConfiguration,
  EndgeDiagnosticsConfiguration,
  EndgeDiagnosticsRoute,
} from '@/domain/types/diagnostics/diagnostics.types'
import type { EndgeExecutionContext } from '@/domain/types/runtime/execution-context.types'

export interface EndgeLocaleDefinition {
  code: string
  displayName: string
  shortLabel: string
  direction?: 'ltr' | 'rtl'
}

export interface EndgeThemeDefinition {
  identity: string
  displayName: string
}

export interface EndgeVariableDefinition {
  name: string
  defaultValue: string
}

/** Effective defaults завершения одной SFC edit session. */
export interface EndgeSFCEditingConfiguration {
  cancelOn: ComponentSFCInteractionTrigger[]
  commitOn: ComponentSFCInteractionTrigger[]
}

/** Полная конфигурация, с которой компилируется один Endge context. */
export interface EndgeConfiguration {
  vars: EndgeVariableDefinition[]
  locales: EndgeLocaleDefinition[]
  defaultLocale: string
  fallbackLocale: string
  themes: EndgeThemeDefinition[]
  defaultTheme: string
  defaultAuthProfileIdentity: string | null
  sfcAdapterIds: string[]
  defaultSfcAdapterId: string
  /** Effective triggers, которые наследуют editable-узлы без локальных атрибутов. */
  sfcEditing: EndgeSFCEditingConfiguration
  /** Настройки telemetry, output adapters, routing и snapshots. */
  diagnostics: EndgeDiagnosticsConfiguration
}

export type EndgeValueOverride<T> =
  | { op: 'set', value: T }
  | { op: 'remove' }

/** Независимые override-операции SFC editing для одного configuration layer. */
export interface EndgeSFCEditingConfigurationPatch {
  cancelOn?: EndgeValueOverride<ComponentSFCInteractionTrigger[]>
  commitOn?: EndgeValueOverride<ComponentSFCInteractionTrigger[]>
}

export type EndgeCollectionPatchEntry<T> =
  | { key: string, op: 'upsert', value: T }
  | { key: string, op: 'remove' }

export interface EndgeCollectionPatch<T> {
  entries: EndgeCollectionPatchEntry<T>[]
}

/** Локальные операции inherit-слоя. Отсутствующее поле наследуется без изменений. */
export interface EndgeConfigurationPatch {
  vars?: EndgeCollectionPatch<EndgeVariableDefinition>
  locales?: EndgeCollectionPatch<EndgeLocaleDefinition>
  defaultLocale?: EndgeValueOverride<string>
  fallbackLocale?: EndgeValueOverride<string>
  themes?: EndgeCollectionPatch<EndgeThemeDefinition>
  defaultTheme?: EndgeValueOverride<string>
  defaultAuthProfileIdentity?: EndgeValueOverride<string>
  sfcAdapterIds?: EndgeCollectionPatch<string>
  defaultSfcAdapterId?: EndgeValueOverride<string>
  sfcEditing?: EndgeSFCEditingConfigurationPatch
  /** Локальный contribution diagnostics для текущего configuration layer. */
  diagnostics?: EndgeDiagnosticsConfigurationPatch
}

/** Patch локальной collection policy модуля диагностики. */
export interface EndgeDiagnosticsCollectionPatch {
  enabled?: EndgeValueOverride<boolean>
  signals?: EndgeCollectionPatch<DiagnosticsSignal>
  minSeverity?: EndgeValueOverride<DiagnosticsSeverityNumber>
  maxRecords?: EndgeValueOverride<number>
}

/** Patch telemetry configuration с merge outputs и routes по стабильному id. */
export interface EndgeDiagnosticsTelemetryPatch {
  collection?: EndgeDiagnosticsCollectionPatch
  outputs?: EndgeCollectionPatch<EndgeDiagnosticsOutputConfiguration>
  routes?: EndgeCollectionPatch<EndgeDiagnosticsRoute>
}

/** Patch состава диагностического snapshot. */
export interface EndgeDiagnosticsSnapshotContentPatch {
  telemetry?: EndgeValueOverride<boolean>
  problems?: EndgeValueOverride<boolean>
  configuration?: EndgeValueOverride<boolean>
}

/** Patch условий автоматического snapshot. */
export interface EndgeDiagnosticsAutomaticSnapshotPatch {
  enabled?: EndgeValueOverride<boolean>
  errorCount?: EndgeValueOverride<number>
  windowSeconds?: EndgeValueOverride<number>
  cooldownSeconds?: EndgeValueOverride<number>
  outputIds?: EndgeCollectionPatch<string>
}

/** Patch snapshots configuration текущего cascade layer. */
export interface EndgeDiagnosticsSnapshotsPatch {
  content?: EndgeDiagnosticsSnapshotContentPatch
  automatic?: EndgeDiagnosticsAutomaticSnapshotPatch
}

/** Patch diagnostics configuration текущего cascade layer. */
export interface EndgeDiagnosticsConfigurationPatch {
  telemetry?: EndgeDiagnosticsTelemetryPatch
  snapshots?: EndgeDiagnosticsSnapshotsPatch
}

export type EndgeConfigurationContribution =
  | { mode: 'inherit', patch: EndgeConfigurationPatch }
  | { mode: 'replace', value: EndgeConfiguration }

export type EndgeConfigurationLayer = 'workspace' | 'tenant' | 'project' | 'environment'

/** Immutable input, передаваемый compiler strategies. */
export interface EndgeBuildContext {
  workspaceIdentity: string
  execution: EndgeExecutionContext
  configuration: EndgeConfiguration
  contextHash: string
}
