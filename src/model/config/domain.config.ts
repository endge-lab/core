import type { DomainDocumentType } from '@/domain/types/document/document.types'
import type { EndgeDomainCollection } from '@/domain/types/document/domain-provider.type'

import { ComponentType, FilterType, QueryType } from '@/domain/types/document/document.types'

/** Версия схемы workspace snapshot нового backend-сервиса. */
export const ENDGE_DOMAIN_BUNDLE_VERSION = 1

/** Единственное соответствие типов Core каноническим коллекциям service-backend. */
export const ENDGE_SERVICE_COLLECTION_BY_DOCUMENT_TYPE: Partial<Record<DomainDocumentType, EndgeDomainCollection>> = {
  'primitive': 'types',
  'type': 'types',
  [QueryType.REST]: 'queries',
  [QueryType.GraphQL]: 'queries',
  [QueryType.Custom]: 'queries',
  'data-view': 'data-views',
  'composition': 'compositions',
  'store': 'stores',
  'stream': 'streams',
  'update': 'updates',
  'mock': 'mocks',
  [ComponentType.SFC]: 'components',
  'action': 'actions',
  [FilterType.DefaultFilter]: 'filters',
  'converter': 'converters',
  'computation': 'computations',
  'vocabs': 'vocabs',
  'i18n-bundles': 'i18n-bundles',
  'auth-profile': 'auth-profiles',
  'navigation': 'navigations',
  'style': 'styles',
  'environment': 'environments',
  'tenant': 'tenants',
  'project': 'projects',
}
