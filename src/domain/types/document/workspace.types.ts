import type {
  EndgeConfiguration,
  EndgeLocaleDefinition,
  EndgeThemeDefinition,
  EndgeVariableDefinition,
} from '@/domain/types/configuration/configuration.type'
import type { EntityManagement } from './entity-management.type'

export type EndgeWorkspaceLocale = EndgeLocaleDefinition
export type EndgeDataMode = 'live' | 'mock'

export type EndgeWorkspaceLocaleLabelMode = keyof Pick<EndgeWorkspaceLocale, 'displayName' | 'shortLabel'>

export type EndgeWorkspaceTheme = EndgeThemeDefinition
export type EndgeWorkspaceVar = EndgeVariableDefinition

export interface WorkspaceIntegrationReference {
  integrationId: string | number
  integrationIdentity: string
  version: string
}

export interface EndgeWorkspaceDefinition extends EntityManagement {
  identity: string
  displayName: string
  dataMode: EndgeDataMode
  meta?: Record<string, unknown>
  installedIntegrations: WorkspaceIntegrationReference[]
  configuration: EndgeConfiguration
}

export type EndgeWorkspaceDefinitionInput = Partial<EndgeWorkspaceDefinition> & Record<string, unknown>
