import type { ComponentSFCInteractionKeyboardCondition, ComponentSFCInteractionTrigger } from '@/domain/types/component/sfc/ir.types'
import type {
  DiagnosticsSeverityNumber,
  DiagnosticsSignal,
  EndgeDiagnosticsOutputConfiguration,
  EndgeDiagnosticsConfiguration,
  EndgeDiagnosticsRoute,
} from '@/domain/types/diagnostics/diagnostics.types'
import type { EndgeExecutionContext } from '@/domain/types/runtime/execution-context.types'
import type { EndgeJSONValue } from '@/domain/types/source/configuration-source.types'

export type EndgeConfigurationValues = Record<string, Record<string, EndgeJSONValue>>
export type EndgeConfigurationValuePatch = Record<string, Record<string, EndgeValueOverride<EndgeJSONValue>>>

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

export interface EndgeTimezoneDefinition {
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

export type EndgeTooltipSide = 'top' | 'right' | 'bottom' | 'left'
export type EndgeTooltipAlign = 'start' | 'center' | 'end'

/** Effective behavioral defaults of the single Shell-owned tooltip overlay. */
export interface EndgeTooltipConfiguration {
  side: EndgeTooltipSide
  align: EndgeTooltipAlign
  openDelay: number
  closeDelay: number
  /** Optional keyboard state required while the pointer or focus activates a tooltip. */
  keyboard?: ComponentSFCInteractionKeyboardCondition
}

/** Полная конфигурация, с которой компилируется один Endge context. */
export interface EndgeConfiguration {
  vars: EndgeVariableDefinition[]
  locales: EndgeLocaleDefinition[]
  defaultLocale: string
  fallbackLocale: string
  themes: EndgeThemeDefinition[]
  defaultTheme: string
  timezones: EndgeTimezoneDefinition[]
  defaultTimezone: string
  defaultAuthProfileIdentity: string | null
  sfcAdapterIds: string[]
  defaultSfcAdapterId: string
  /** Effective triggers, которые наследуют editable-узлы без локальных атрибутов. */
  sfcEditing: EndgeSFCEditingConfiguration
  /** Effective tooltip behavior. Visual styling is owned by CSS and adapter hooks. */
  tooltips: EndgeTooltipConfiguration
  /** Настройки telemetry, output adapters, routing и snapshots. */
  diagnostics: EndgeDiagnosticsConfiguration
  /** Persisted/effective values grouped by Configuration document identity. */
  values: EndgeConfigurationValues
}

/** Deep-readonly, SFC-visible effective configuration projection. */
export type EndgePublicConfigurationSnapshot = Readonly<
  Omit<EndgeConfiguration, 'vars' | 'diagnostics' | 'values'>
  & Record<string, unknown>
>

export type EndgeValueOverride<T> =
  | { op: 'set', value: T }
  | { op: 'remove' }

/** Независимые override-операции SFC editing для одного configuration layer. */
export interface EndgeSFCEditingConfigurationPatch {
  cancelOn?: EndgeValueOverride<ComponentSFCInteractionTrigger[]>
  commitOn?: EndgeValueOverride<ComponentSFCInteractionTrigger[]>
}

/** Field-level tooltip overrides for one configuration cascade layer. */
export interface EndgeTooltipConfigurationPatch {
  side?: EndgeValueOverride<EndgeTooltipSide>
  align?: EndgeValueOverride<EndgeTooltipAlign>
  openDelay?: EndgeValueOverride<number>
  closeDelay?: EndgeValueOverride<number>
  keyboard?: EndgeValueOverride<ComponentSFCInteractionKeyboardCondition>
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
  timezones?: EndgeCollectionPatch<EndgeTimezoneDefinition>
  defaultTimezone?: EndgeValueOverride<string>
  defaultAuthProfileIdentity?: EndgeValueOverride<string>
  sfcAdapterIds?: EndgeCollectionPatch<string>
  defaultSfcAdapterId?: EndgeValueOverride<string>
  sfcEditing?: EndgeSFCEditingConfigurationPatch
  tooltips?: EndgeTooltipConfigurationPatch
  /** Локальный contribution diagnostics для текущего configuration layer. */
  diagnostics?: EndgeDiagnosticsConfigurationPatch
  /** Field-level overrides of source-backed Configuration values. */
  values?: EndgeConfigurationValuePatch
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
