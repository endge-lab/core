export interface EndgeWorkspaceLocale {
  code: string
  label: string
  nativeLabel: string
  shortLabel: string
  direction?: 'ltr' | 'rtl'
}

export interface EndgeWorkspaceDefinition {
  identity: string
  displayName: string
  locales: EndgeWorkspaceLocale[]
  defaultLocale: string
  fallbackLocale: string
}
