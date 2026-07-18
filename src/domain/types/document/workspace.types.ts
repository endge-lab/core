import type {
  EndgeConfiguration,
  EndgeLocaleDefinition,
  EndgeSSEAuthMode,
  EndgeSSEConfiguration,
  EndgeThemeDefinition,
  EndgeVariableDefinition,
} from '@/domain/types/configuration'
import type { EntityManagement } from './entity-management.type'

export type EndgeWorkspaceLocale = EndgeLocaleDefinition

export type EndgeWorkspaceLocaleLabelMode = keyof Pick<EndgeWorkspaceLocale, 'displayName' | 'shortLabel'>

export type EndgeWorkspaceTheme = EndgeThemeDefinition
export type EndgeWorkspaceSSEAuthMode = EndgeSSEAuthMode
export type EndgeWorkspaceVar = EndgeVariableDefinition
export type EndgeWorkspaceSSEConfig = EndgeSSEConfiguration

export interface WorkspaceIntegrationReference {
  integrationId: string | number
  integrationIdentity: string
  version: string
}

export interface EndgeWorkspaceDefinition extends EntityManagement {
  identity: string
  displayName: string
  installedIntegrations: WorkspaceIntegrationReference[]
  configuration: EndgeConfiguration
}

export type EndgeWorkspaceDefinitionInput = Partial<EndgeWorkspaceDefinition> & Record<string, unknown>
