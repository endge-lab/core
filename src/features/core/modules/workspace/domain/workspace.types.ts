import type {
  EndgeConfiguration,
  EndgeLocaleDefinition,
  EndgeThemeDefinition,
  EndgeTimezoneDefinition,
  EndgeVariableDefinition,
} from '@/features/core/modules/configuration/domain/types/configuration.type'
import type { EntityManagement } from '@/features/core/modules/domain/types/document/entity-management.type'

export type EndgeWorkspaceLocale = EndgeLocaleDefinition
export type EndgeDataMode = 'live' | 'mock'
export type EndgeWorkspaceDocumentStructure = 'frontend' | 'custom'

export type EndgeWorkspaceLocaleLabelMode = keyof Pick<EndgeWorkspaceLocale, 'displayName' | 'shortLabel'>

export type EndgeWorkspaceTheme = EndgeThemeDefinition
export type EndgeWorkspaceTimezone = EndgeTimezoneDefinition
export type EndgeWorkspaceVar = EndgeVariableDefinition

/** Фактическая переменная workspace после применения переопределений runtime и окружения. */
export interface EndgeResolvedWorkspaceVariable {
  name: string
  defaultValue: string
  currentValue: string
}

export interface WorkspaceIntegrationReference {
  integrationId: string | number
  integrationIdentity: string
  version: string
}

export interface EndgeWorkspaceDefinition extends EntityManagement {
  identity: string
  displayName: string
  dataMode: EndgeDataMode
  /** Способ организации документов; legacy payloads без поля нормализуются в frontend. */
  documentStructure?: EndgeWorkspaceDocumentStructure
  meta?: Record<string, unknown>
  installedIntegrations: WorkspaceIntegrationReference[]
  configuration: EndgeConfiguration
}

export type EndgeWorkspaceDefinitionInput = Partial<EndgeWorkspaceDefinition> & Record<string, unknown>
