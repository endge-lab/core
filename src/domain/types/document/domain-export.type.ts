import type { EndgeWorkspaceDefinition, EndgeWorkspaceSSEConfig } from '@/domain/types/document/workspace.types'

/** Workspace-конфигурация без прямых credential-значений. */
export type EndgeWorkspaceExport = Omit<EndgeWorkspaceDefinition, 'sse'> & {
  sse?: Omit<EndgeWorkspaceSSEConfig, 'manualToken'>
}

/** Persisted-срез домена, который можно восстановить через plain provider. */
export interface EndgeDomainPlain {
  projects: unknown[]
  types: unknown[]
  queries: unknown[]
  dataViews: unknown[]
  compositions: unknown[]
  stores: unknown[]
  mocks: unknown[]
  components: unknown[]
  componentSFCs: unknown[]
  actions: unknown[]
  converters: unknown[]
  integrations: unknown[]
  views: unknown[]
  folders: unknown[]
  parameters: unknown[]
  filters: unknown[]
  environments: unknown[]
  tenants: unknown[]
  behaviorBindings: unknown[]
  presentationBindings: unknown[]
  policies: unknown[]
  styles: unknown[]
  vocabs: unknown[]
  authProfiles: unknown[]
  i18nBundles: unknown[]
  pageTemplates: unknown[]
  pages: unknown[]
  navigations: unknown[]
}

/** Переносимый bundle текущего workspace и его загруженного домена. */
export interface EndgeDomainBundle {
  version: string
  workspace: EndgeWorkspaceExport
  domain: EndgeDomainPlain
}
