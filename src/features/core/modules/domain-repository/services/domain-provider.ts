import type { DomainDocumentType } from '@/features/core/modules/domain/types/document/document.types'
import type { EndgeDomainCollection } from '@/features/core/modules/domain/types/document/domain-provider.type'

import { DOMAIN_DOCUMENT_DESCRIPTORS } from '@/features/core/modules/domain/documents/domain-document-descriptors'

const ENDGE_SERVICE_COLLECTIONS = new Set<EndgeDomainCollection>(
  Object.values(DOMAIN_DOCUMENT_DESCRIPTORS)
    .flatMap(descriptor => descriptor.persistence?.collection ?? []),
)

export class EndgeProviderCollectionUnsupportedError extends Error {
  public readonly code = 'provider_collection_unsupported'

  public constructor(public readonly documentType: DomainDocumentType) {
    super(`Service backend does not support document type: ${documentType}`)
    this.name = 'EndgeProviderCollectionUnsupportedError'
  }
}

export function resolveEndgeServiceCollection(documentType: DomainDocumentType): EndgeDomainCollection {
  const collection = DOMAIN_DOCUMENT_DESCRIPTORS[documentType].persistence?.collection
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
