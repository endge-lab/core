import type { DomainDocumentType } from '@/domain/types/document/document.types'
import type { EndgeDomainCollection } from '@/domain/types/document/domain-provider.type'

import { ComponentType, FilterType, QueryType } from '@/domain/types/document/document.types'

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

const ENDGE_SERVICE_COLLECTIONS = new Set<EndgeDomainCollection>(
  Object.values(ENDGE_SERVICE_COLLECTION_BY_DOCUMENT_TYPE),
)

export class EndgeProviderCollectionUnsupportedError extends Error {
  public readonly code = 'provider_collection_unsupported'

  public constructor(public readonly documentType: DomainDocumentType) {
    super(`Service backend does not support document type: ${documentType}`)
    this.name = 'EndgeProviderCollectionUnsupportedError'
  }
}

export function resolveEndgeServiceCollection(documentType: DomainDocumentType): EndgeDomainCollection {
  const collection = ENDGE_SERVICE_COLLECTION_BY_DOCUMENT_TYPE[documentType]
  if (!collection)
    throw new EndgeProviderCollectionUnsupportedError(documentType)
  return collection
}

/** Принимает canonical collection либо Core document type для server-state lookup. */
export function resolveEndgeServiceStateCollection(value: string): EndgeDomainCollection {
  if (ENDGE_SERVICE_COLLECTIONS.has(value as EndgeDomainCollection))
    return value as EndgeDomainCollection
  return resolveEndgeServiceCollection(value as DomainDocumentType)
}
