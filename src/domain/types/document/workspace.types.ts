import type {
  EndgeConfiguration,
  EndgeLocaleDefinition,
  EndgeSSEAuthMode,
  EndgeSSEConfiguration,
  EndgeThemeDefinition,
  EndgeVariableDefinition,
} from '@/domain/types/configuration'

export type EndgeWorkspaceLocale = EndgeLocaleDefinition

export type EndgeWorkspaceLocaleLabelMode = keyof Pick<EndgeWorkspaceLocale, 'displayName' | 'shortLabel'>

export type EndgeWorkspaceTheme = EndgeThemeDefinition
export type EndgeWorkspaceSSEAuthMode = EndgeSSEAuthMode
export type EndgeWorkspaceVar = EndgeVariableDefinition
export type EndgeWorkspaceSSEConfig = EndgeSSEConfiguration

export interface EndgeWorkspaceDefinition {
  identity: string
  displayName: string
  configuration: EndgeConfiguration
}

export type EndgeWorkspaceDefinitionInput = Partial<EndgeWorkspaceDefinition> & Record<string, unknown>
