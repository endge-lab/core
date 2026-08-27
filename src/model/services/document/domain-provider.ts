import type { DomainDocumentType } from '@/domain/types/document/document.types'
import type { EndgeDomainCollection } from '@/domain/types/document/domain-provider.type'

import { ENDGE_SERVICE_COLLECTION_BY_DOCUMENT_TYPE } from '@/model/config/domain.config'

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
  if (!collection) {
    throw new EndgeProviderCollectionUnsupportedError(documentType)
  }
  return collection
}

/** Принимает canonical collection либо Core document type для server-state lookup. */
export function resolveEndgeServiceStateCollection(value: string): EndgeDomainCollection {
  if (ENDGE_SERVICE_COLLECTIONS.has(value as EndgeDomainCollection)) {
    return value as EndgeDomainCollection
  }
  return resolveEndgeServiceCollection(value as DomainDocumentType)
}
