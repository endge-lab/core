export interface EndgeWorkspaceLocale {
  code: string
  displayName: string
  shortLabel: string
  direction?: 'ltr' | 'rtl'
}

export type EndgeWorkspaceLocaleLabelMode = keyof Pick<EndgeWorkspaceLocale, 'displayName' | 'shortLabel'>

export type EndgeWorkspaceSSEAuthMode = 'inherit' | 'profile' | 'manual' | 'none'

export interface EndgeWorkspaceVar {
  name: string
  defaultValue: string
}

export interface EndgeWorkspaceSSEConfig {
  url: string
  authMode?: EndgeWorkspaceSSEAuthMode
  authProfileIdentity?: string | null
  manualToken?: string | null
}

export interface EndgeWorkspaceDefinition {
  identity: string
  displayName: string
  vars: EndgeWorkspaceVar[]
  sse?: EndgeWorkspaceSSEConfig
  locales: EndgeWorkspaceLocale[]
  defaultLocale: string
  fallbackLocale: string
  defaultAuthProfileIdentity: string | null
  sfcAdapterIds: string[]
  defaultSfcAdapterId: string
}

export type EndgeWorkspaceDefinitionInput = Partial<EndgeWorkspaceDefinition> & Record<string, unknown>
