import type { EndgeDomainPlain } from '@/features/core/modules/domain/types/document/domain-export.type'
import type { ExecutionBundle } from '@/features/core/modules/program/domain/types/execution-bundle.types'
import type { ProgramArtifact } from '@/features/core/modules/program/domain/types/program.types'
import { COLLECTION_TYPES } from '@/features/core/modules/compiler/tools/compiled-program-catalog'

const collections = {
  'mock-data': 'mocks',
  'mock': 'mocks',
  'auth-profile': 'authProfiles',
  'i18n-bundles': 'i18nBundles',
  'converter': 'converters',
} as const

function deliveryDocumentReferences(bundle: ExecutionBundle) {
  const references = new Map<keyof NonNullable<ExecutionBundle['runtimeDocuments']>, Set<string>>()
  const pending: ProgramArtifact[] = [...Object.values(bundle.artifacts)]
  const add = (collection: typeof collections[keyof typeof collections], identity: string) => {
    const identities = references.get(collection) ?? new Set<string>()
    identities.add(identity)
    references.set(collection, identities)
  }
  while (pending.length > 0) {
    const artifact = pending.pop()!
    pending.push(...artifact.children ?? [])
    for (const dependency of artifact.dependencies) {
      const collection = collections[dependency.entityType as keyof typeof collections]
      if (collection && !dependency.validationOnly) {
        add(collection, String(dependency.identity ?? dependency.id))
      }
    }
  }
  if (bundle.context.configuration.defaultAuthProfileIdentity) {
    add('authProfiles', bundle.context.configuration.defaultAuthProfileIdentity)
  }
  return references
}

export function projectDeliveryDocuments(bundle: ExecutionBundle, domain: EndgeDomainPlain): NonNullable<ExecutionBundle['runtimeDocuments']> {
  return Object.fromEntries([...deliveryDocumentReferences(bundle)].map(([collection, identities]) => [
    collection,
    domain[collection].filter(document => isReferencedDocument(document, identities)),
  ]))
}

function isReferencedDocument(value: unknown, identities: ReadonlySet<string>): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
    && (('identity' in value && identities.has(String(value.identity))) || ('id' in value && identities.has(String(value.id))))
}

export function validateDeliveryDocuments(bundle: ExecutionBundle): void {
  const expected = deliveryDocumentReferences(bundle)
  for (const [collection, documents] of Object.entries(bundle.runtimeDocuments ?? {})) {
    const identities = expected.get(collection as keyof NonNullable<ExecutionBundle['runtimeDocuments']>)
    if (!identities || !Array.isArray(documents) || documents.some(document => !isReferencedDocument(document, identities))) {
      throw new Error('[Bundle] Unrelated runtime documents in delivery')
    }
  }
}

export function materializeDeliveryDomain(bundle: ExecutionBundle): Record<string, unknown[]> {
  validateDeliveryDocuments(bundle)
  const domain: Record<string, unknown[]> = { ...bundle.runtimeDocuments }
  const typeToCollection = new Map(Object.entries(COLLECTION_TYPES).map(([collection, type]) => [type, collection]))
  for (const artifact of Object.values(bundle.artifacts)) {
    const { id, identity, entityType } = artifact.ref
    const collection = typeToCollection.get(entityType)
    if (collection) {
      const document = bundle.catalog.documents[`${entityType}:${id}`]
      ;(domain[collection] ??= []).push({
        id,
        identity,
        name: document?.displayName ?? identity,
        displayName: document?.displayName ?? identity,
        ...(document?.kind ? { kind: document.kind } : {}),
        ...(document?.kindIdentity ? { kindIdentity: document.kindIdentity } : {}),
      })
    }
  }
  return domain
}
