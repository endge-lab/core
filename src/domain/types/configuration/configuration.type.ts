import type {
  DiagnosticsSeverityNumber,
  DiagnosticsSignal,
  EndgeDiagnosticsConfiguration,
  EndgeDiagnosticsRoute,
} from '@/domain/types/diagnostics'

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

export type EndgeSSEAuthMode = 'inherit' | 'profile' | 'manual' | 'none'

export interface EndgeVariableDefinition {
  name: string
  defaultValue: string
}

export interface EndgeSSEConfiguration {
  url: string
  authMode?: EndgeSSEAuthMode
  authProfileIdentity?: string | null
  manualToken?: string | null
}

/** Полная конфигурация, с которой компилируется один Endge context. */
export interface EndgeConfiguration {
  vars: EndgeVariableDefinition[]
  sse?: EndgeSSEConfiguration
  locales: EndgeLocaleDefinition[]
  defaultLocale: string
  fallbackLocale: string
  themes: EndgeThemeDefinition[]
  defaultTheme: string
  defaultAuthProfileIdentity: string | null
  sfcAdapterIds: string[]
  defaultSfcAdapterId: string
  /** Настройки локального сбора и маршрутизации diagnostic records. */
  diagnostics: EndgeDiagnosticsConfiguration
}

export type EndgeValueOverride<T> =
  | { op: 'set', value: T }
  | { op: 'remove' }

export type EndgeCollectionPatchEntry<T> =
  | { key: string, op: 'upsert', value: T }
  | { key: string, op: 'remove' }

export interface EndgeCollectionPatch<T> {
  entries: EndgeCollectionPatchEntry<T>[]
}

/** Локальные операции inherit-слоя. Отсутствующее поле наследуется без изменений. */
export interface EndgeConfigurationPatch {
  vars?: EndgeCollectionPatch<EndgeVariableDefinition>
  sse?: EndgeValueOverride<EndgeSSEConfiguration>
  locales?: EndgeCollectionPatch<EndgeLocaleDefinition>
  defaultLocale?: EndgeValueOverride<string>
  fallbackLocale?: EndgeValueOverride<string>
  themes?: EndgeCollectionPatch<EndgeThemeDefinition>
  defaultTheme?: EndgeValueOverride<string>
  defaultAuthProfileIdentity?: EndgeValueOverride<string>
  sfcAdapterIds?: EndgeCollectionPatch<string>
  defaultSfcAdapterId?: EndgeValueOverride<string>
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

/** Patch diagnostics configuration с merge маршрутов по стабильному id. */
export interface EndgeDiagnosticsConfigurationPatch {
  collection?: EndgeDiagnosticsCollectionPatch
  routes?: EndgeCollectionPatch<EndgeDiagnosticsRoute>
}

export type EndgeConfigurationContribution =
  | { mode: 'inherit', patch: EndgeConfigurationPatch }
  | { mode: 'replace', value: EndgeConfiguration }

export type EndgeConfigurationLayer = 'workspace' | 'tenant' | 'project' | 'environment'

/** Structural context одного полного boot/build lifecycle. */
export interface EndgeExecutionContext {
  tenantIdentity: string
  projectIdentity: string
  environmentIdentity: string
}

/** Immutable input, передаваемый compiler strategies. */
export interface EndgeBuildContext {
  workspaceIdentity: string
  execution: EndgeExecutionContext
  configuration: EndgeConfiguration
  contextHash: string
}
