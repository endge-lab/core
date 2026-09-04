import type { EndgeWorkspaceDefinition } from '@/features/core/modules/workspace/domain/workspace.types'

/** Workspace-конфигурация не содержит credential material. */
export type EndgeWorkspaceExport = EndgeWorkspaceDefinition

/** Persisted-срез домена, который можно восстановить через plain provider. */
export interface EndgeDomainPlain {
  projects: unknown[]
  types: unknown[]
  queries: unknown[]
  dataViews: unknown[]
  compositions: unknown[]
  stores: unknown[]
  streams: unknown[]
  updates: unknown[]
  mocks: unknown[]
  components: unknown[]
  componentSFCs: unknown[]
  actions: unknown[]
  converters: unknown[]
  computations: unknown[]
  integrations: unknown[]
  folders: unknown[]
  parameters: unknown[]
  filters: unknown[]
  environments: unknown[]
  tenants: unknown[]
  policies: unknown[]
  styles: unknown[]
  configurations: unknown[]
  vocabs: unknown[]
  authProfiles: unknown[]
  i18nBundles: unknown[]
  pageTemplates: unknown[]
  pages: unknown[]
  navigations: unknown[]
}

/** Коллекции документов канонического snapshot нового backend-сервиса. */
export interface EndgePortableDocuments {
  'projects': unknown[]
  'tenants': unknown[]
  'environments': unknown[]
  'folders': unknown[]
  'types': unknown[]
  'queries': unknown[]
  'data-views': unknown[]
  'compositions': unknown[]
  'stores': unknown[]
  'streams': unknown[]
  'updates': unknown[]
  'mocks': unknown[]
  'components': unknown[]
  'actions': unknown[]
  'filters': unknown[]
  'converters': unknown[]
  'computations': unknown[]
  'vocabs': unknown[]
  'i18n-bundles': unknown[]
  'auth-profiles': unknown[]
  'navigations': unknown[]
  'styles': unknown[]
  'configurations': unknown[]
}

export interface EndgeInstalledIntegrationExport {
  identity: string
  version: string
  configuration: Record<string, unknown>
}

export type EndgePortableWorkspace = Omit<EndgeWorkspaceExport, 'installedIntegrations' | 'dataMode'> & {
  dataMode: 'development' | 'production'
}

/** Переносимый workspace snapshot, принимаемый новым backend import API. */
export interface EndgeDomainBundle {
  schemaVersion: number
  kind: 'workspace-snapshot'
  domainVersion?: string
  workspace: EndgePortableWorkspace
  installedIntegrations: EndgeInstalledIntegrationExport[]
  documents: EndgePortableDocuments
}
