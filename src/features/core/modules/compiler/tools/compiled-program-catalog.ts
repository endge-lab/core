import type { EndgeDomain_Module } from '@/features/core/modules/domain/EndgeDomain_Module'
import type { CompiledProgramCatalog } from '@/features/core/modules/program/domain/types/execution-bundle.types'
import type { ProgramArtifact } from '@/features/core/modules/program/domain/types/program.types'

import { Endge } from '@/features/core/kernel/endge'

const COLLECTION_TYPES: Record<string, string> = {
  componentSFCs: 'component-sfc',
  dataViews: 'data-view',
  queries: 'query',
  compositions: 'composition',
  types: 'type',
  stores: 'store',
  streams: 'stream',
  simulations: 'simulation',
  updates: 'update',
  computations: 'computation',
  actions: 'action',
  filters: 'filter',
  styles: 'style',
  configurations: 'configuration',
  vocabs: 'vocab',
  facets: 'facet',
  facetDocuments: 'facet-document',
  mocks: 'mock',
  components: 'component',
  converters: 'converter',
  integrations: 'integration',
  policies: 'policy',
  authProfiles: 'auth-profile',
  i18nBundles: 'i18n-bundles',
  pageTemplates: 'page-template',
  pages: 'page',
  navigations: 'navigation',
}

// Сохраняет только навигационные дескрипторы полного compile snapshot, без authoring Source.
export function createCompiledProgramCatalog(
  domain: EndgeDomain_Module,
  artifacts: readonly ProgramArtifact[],
): CompiledProgramCatalog {
  const result: CompiledProgramCatalog = { folders: {}, documents: {} }
  if (Endge.workspace.isLoaded) {
    const workspace = Endge.workspace.current
    result.workspace = { identity: workspace.identity, displayName: workspace.displayName, startupCompositionIdentity: workspace.startupCompositionIdentity, documentStructure: workspace.documentStructure ?? 'frontend' }
  }
  // Read navigation from loaded entities: authoring toPlain() intentionally omits
  // placement or server IDs for some Source document families.
  const loaded = {
    folders: domain.getFolders(),
    facets: domain.getFacets(),
    facetDocuments: domain.getFacets().flatMap(facet => domain.getFacetDocuments(facet.identity)),
    types: domain.getTypes(),
    queries: domain.getQueries(),
    dataViews: domain.getDataViews(),
    compositions: domain.getCompositions(),
    stores: domain.getStores(),
    streams: domain.getStreams(),
    simulations: domain.getSimulations(),
    updates: domain.getUpdates(),
    mocks: domain.getMocks(),
    computations: domain.getComputations(),
    components: domain.getComponents(),
    componentSFCs: domain.getComponentSFCs(),
    actions: domain.getActions(),
    converters: domain.getConverters(),
    integrations: domain.getIntegrations(),
    filters: domain.getFilters(),
    policies: domain.getPolicies(),
    styles: domain.getStyles(),
    configurations: domain.getConfigurations(),
    vocabs: domain.getVocabs(),
    authProfiles: domain.getAuthProfiles(),
    i18nBundles: domain.getI18nBundles(),
    pageTemplates: domain.getPageTemplates(),
    pages: domain.getPages(),
    navigations: domain.getNavigations(),
  }
  const collections = Object.fromEntries(Object.entries(loaded).map(([key, entities]) => [
    key,
    entities.filter(entity => entity.isTemporary !== true && (entity.origin?.kind ?? 'storage') === 'storage'),
  ])) as unknown as Record<string, Array<Record<string, unknown>>>
  for (const [position, folder] of (collections.folders ?? []).entries()) {
    const id = String(folder.id)
    result.folders[id] = {
      id,
      identity: String(folder.identity ?? id),
      displayName: String(folder.displayName ?? folder.name ?? id),
      parentId: folder.parent == null ? null : String(folder.parent),
      scope: folder.scope === 'workspace' ? 'workspace' : 'collection',
      entityType:
        typeof folder.entityType === 'string' ? folder.entityType : null,
      position,
      ...(typeof folder.icon === 'string' ? { icon: folder.icon } : {}),
      ...(typeof folder.color === 'string' ? { color: folder.color } : {}),
    }
  }
  for (const [collection, entries] of Object.entries(collections)) {
    if (collection === 'folders' || !Array.isArray(entries)) {
      continue
    }
    const entityType = COLLECTION_TYPES[collection] ?? collection
    entries.forEach((document, position) => {
      const identity = String(document.identity ?? document.id)
      const artifactKeys = artifacts
        .filter(
          artifact =>
            artifact.ref.entityType === entityType
            && (artifact.ref.identity === identity
              || String(artifact.ref.id) === String(document.id)),
        )
        .map(artifact => `${artifact.ref.entityType}:${artifact.ref.id}`)
      const folderId
        = document.folderId == null ? null : String(document.folderId)
      const workspaceFolderId
        = document.workspaceFolderId == null
          ? null
          : String(document.workspaceFolderId)
      result.documents[`${entityType}:${document.id ?? identity}`] = {
        id: String(document.id ?? identity),
        identity,
        entityType,
        displayName: String(document.displayName ?? document.name ?? identity),
        folderId,
        workspaceFolderId,
        position,
        ...(typeof document.type === 'string' ? { documentType: document.type } : {}),
        ...Object.fromEntries(['facetIdentity', 'kind', 'kindIdentity', 'storeIdentity', 'icon', 'color']
          .filter(field => typeof document[field] === 'string')
          .map(field => [field, document[field]])),
        artifactKeys,
        status: artifactKeys.length ? 'compiled' : 'not-compiled',
      }
    })
  }
  return result
}
