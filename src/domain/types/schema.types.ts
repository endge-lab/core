import type { Projects_Repository } from '@/model/db/repositories/Projects_Repository'
import type { Types_Repository } from '@/model/db/repositories/Types_Repository'
import type { Queries_Repository } from '@/model/db/repositories/Queries_Repository'
import type { DataViews_Repository } from '@/model/db/repositories/DataViews_Repository'
import type { Folders_Repository } from '@/model/db/repositories/Folders_Repository'
import type { Components_Repository } from '@/model/db/repositories/Components_Repository'
import type { ComponentSFCs_Repository } from '@/model/db/repositories/ComponentSFCs_Repository'
import type { Scenarios_Repository } from '@/model/db/repositories/Scenarios_Repository'
import type { Actions_Repository } from '@/model/db/repositories/Actions_Repository'
import type { Settings_Repository } from '@/model/db/repositories/Settings_Repository'
import type { Vocabs_Repository } from '@/model/db/repositories/Vocabs_Repository'
import type { I18nBundles_Repository } from '@/model/db/repositories/I18nBundles_Repository'
import type { Parameters_Repository } from '@/model/db/repositories/Parameters_Repository'
import type { Filters_Repository } from '@/model/db/repositories/Filters_Repository'
import type { Converters_Repository } from '@/model/db/repositories/Converters_Repository'
import type { Integrations_Repository } from '@/model/db/repositories/Integrations_Repository'
import type { Versions_Repository } from '@/model/db/repositories/Versions_Repository'
import type { Views_Repository } from '@/model/db/repositories/Views_Repository'
import type { PageTemplates_Repository } from '@/model/db/repositories/PageTemplates_Repository'
import type { Pages_Repository } from '@/model/db/repositories/Pages_Repository'
import type { Navigations_Repository } from '@/model/db/repositories/Navigations_Repository'
import type { Environments_Repository } from '@/model/db/repositories/Environments_Repository'
import type { Policies_Repository } from '@/model/db/repositories/Policies_Repository'
import type { Styles_Repository } from '@/model/db/repositories/Styles_Repository'
import type { Tenants_Repository } from '@/model/db/repositories/Tenants_Repository'
import type { BehaviorBindings_Repository } from '@/model/db/repositories/BehaviorBindings_Repository'
import type { PresentationBindings_Repository } from '@/model/db/repositories/PresentationBindings_Repository'

export interface EndgeSchemaDump {
  projects: any[]
  types: any[]
  queries: any[]
  dataViews: any[]
  folders: any[]
  components: any[]
  componentSFCs: any[]
  scenarios: any[]
  actions: any[]
  converters: any[]
  integrations: any[]
  views: any[]
  settings: any[]
  vocabs: any[]
  i18nBundles: any[]
  parameters: any[]
  filters: any[]
  versions: any[]
  environments: any[]
  tenants: any[]
  behaviorBindings: any[]
  presentationBindings: any[]
  policies: any[]
  styles: any[]
  pageTemplates: any[]
  pages: any[]
  navigations: any[]
}

export type EndgeSchemaErrorKind =
  | 'PAYLOAD_NOT_CONFIGURED'
  | 'PAYLOAD_PING_FAILED'
  | 'COLLECTION_UNREACHABLE'

export interface EndgeSchemaError {
  kind: EndgeSchemaErrorKind
  message: string
  collection?: string
  details?: any
  at: string // ISO-string
}

export type RepositoriesBag = {
  projects: Projects_Repository
  types: Types_Repository
  queries: Queries_Repository
  dataViews: DataViews_Repository
  folders: Folders_Repository
  components: Components_Repository
  componentSFCs: ComponentSFCs_Repository
  scenarios: Scenarios_Repository
  actions: Actions_Repository
  settings: Settings_Repository
  vocabs: Vocabs_Repository
  i18nBundles: I18nBundles_Repository
  parameters: Parameters_Repository
  filters: Filters_Repository
  converters: Converters_Repository
  integrations: Integrations_Repository
  views: Views_Repository
  versions: Versions_Repository
  environments: Environments_Repository
  tenants: Tenants_Repository
  behaviorBindings: BehaviorBindings_Repository
  presentationBindings: PresentationBindings_Repository
  policies: Policies_Repository
  styles: Styles_Repository
  pageTemplates: PageTemplates_Repository
  pages: Pages_Repository
  navigations: Navigations_Repository
}

export interface EndgeSchemaStorageOptions {
  payloadBaseAPI: string
  payloadSecret: string
  collectionsToCheck?: string[]
}
