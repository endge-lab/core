import type { EndgeLiveDomainDocument, EndgeLiveDomainSnapshot, EndgeWorkspaceServerState } from '@/features/core/modules/domain/types/document/domain-snapshot.type'

/** Канонические коллекции persisted-домена нового backend. */
export type EndgeDomainCollection
  = | 'facets' | 'facet-documents' | 'projects' | 'tenants' | 'environments' | 'folders' | 'types' | 'queries'
    | 'data-views' | 'compositions' | 'stores' | 'streams' | 'simulations' | 'updates' | 'mocks'
    | 'components' | 'actions' | 'filters' | 'converters' | 'computations' | 'vocabs'
    | 'i18n-bundles' | 'auth-profiles' | 'navigations' | 'styles' | 'configurations'

/** Возможности выбранного источника домена. */
export interface EndgeDomainProviderCapabilities {
  snapshot: true
  mutations: boolean
  softDelete: boolean
  restore: boolean
}

/** Запрос полного состояния workspace. */
export interface EndgeDomainLoadRequest {
  workspaceIdentity: string
  signal?: AbortSignal
}

export interface EndgeDocumentMutationRequest {
  workspaceIdentity: string
  collection: EndgeDomainCollection
  identity: string
  document?: Record<string, unknown>
  expectedRevision?: number
  signal?: AbortSignal
}

export interface EndgeDocumentMutationResult {
  document: EndgeLiveDomainDocument
  etag: string | null
}

/** Документ с optimistic revision для атомарного перемещения. */
export interface EndgeDocumentMoveRequestItem {
  collection: EndgeDomainCollection
  identity: string
  expectedRevision: number
}

/** Запрос атомарного перемещения документов в одну папку. */
export interface EndgeDocumentsMoveRequest {
  workspaceIdentity: string
  documents: EndgeDocumentMoveRequestItem[]
  folderIdentity: string
  placement: 'frontend' | 'workspace'
  signal?: AbortSignal
}

/** Актуальный документ и его transport-коллекция после перемещения. */
export interface EndgeMovedDocument {
  collection: EndgeDomainCollection
  document: EndgeLiveDomainDocument
}

/** Результат атомарного перемещения документов. */
export interface EndgeDocumentsMoveResult {
  documents: EndgeMovedDocument[]
  moved: number
}

export interface EndgeWorkspaceMutationRequest {
  workspaceIdentity: string
  document: Record<string, unknown>
  expectedRevision: number
  signal?: AbortSignal
}

export interface EndgeWorkspaceMutationResult {
  workspace: Record<string, unknown> & { state: EndgeWorkspaceServerState }
  etag: string | null
}

export interface EndgeFacetListRequest {
  workspaceIdentity: string
  includeDeleted?: boolean
  signal?: AbortSignal
}

export interface EndgeFacetDocumentListRequest extends EndgeFacetListRequest {
  facetIdentity: string
}

export interface EndgeFacetMutationRequest {
  workspaceIdentity: string
  identity: string
  document?: Record<string, unknown>
  expectedRevision?: number
  signal?: AbortSignal
}

export interface EndgeFacetDocumentMutationRequest extends EndgeFacetMutationRequest {
  facetIdentity: string
}

export interface EndgeFacetReorderItem {
  identity: string
  expectedRevision: number
}

export interface EndgeFacetReorderRequest {
  workspaceIdentity: string
  items: EndgeFacetReorderItem[]
  signal?: AbortSignal
}

export interface EndgeFacetMutationResult {
  document: EndgeLiveDomainDocument
  etag: string | null
}

export interface EndgeFacetReorderResult {
  documents: EndgeLiveDomainDocument[]
  etag: string | null
}

/** Транспортно-независимый источник полного workspace snapshot. */
export interface EndgeDomainProvider {
  readonly id: string
  readonly capabilities: EndgeDomainProviderCapabilities
  readonly etag: string | null

  loadWorkspace: (request: EndgeDomainLoadRequest) => Promise<EndgeLiveDomainSnapshot>
  createDocument: (request: EndgeDocumentMutationRequest) => Promise<EndgeDocumentMutationResult>
  updateDocument: (request: EndgeDocumentMutationRequest) => Promise<EndgeDocumentMutationResult>
  softDeleteDocument: (request: EndgeDocumentMutationRequest) => Promise<EndgeDocumentMutationResult>
  restoreDocument: (request: EndgeDocumentMutationRequest) => Promise<EndgeDocumentMutationResult>
  moveDocuments?: (request: EndgeDocumentsMoveRequest) => Promise<EndgeDocumentsMoveResult>
  updateWorkspace: (request: EndgeWorkspaceMutationRequest) => Promise<EndgeWorkspaceMutationResult>

  listFacets?: (request: EndgeFacetListRequest) => Promise<EndgeLiveDomainDocument[]>
  createFacet?: (request: EndgeFacetMutationRequest) => Promise<EndgeFacetMutationResult>
  updateFacet?: (request: EndgeFacetMutationRequest) => Promise<EndgeFacetMutationResult>
  softDeleteFacet?: (request: EndgeFacetMutationRequest) => Promise<EndgeFacetMutationResult>
  restoreFacet?: (request: EndgeFacetMutationRequest) => Promise<EndgeFacetMutationResult>
  reorderFacets?: (request: EndgeFacetReorderRequest) => Promise<EndgeFacetReorderResult>
  listFacetDocuments?: (request: EndgeFacetDocumentListRequest) => Promise<EndgeLiveDomainDocument[]>
  createFacetDocument?: (request: EndgeFacetDocumentMutationRequest) => Promise<EndgeFacetMutationResult>
  updateFacetDocument?: (request: EndgeFacetDocumentMutationRequest) => Promise<EndgeFacetMutationResult>
  softDeleteFacetDocument?: (request: EndgeFacetDocumentMutationRequest) => Promise<EndgeFacetMutationResult>
  restoreFacetDocument?: (request: EndgeFacetDocumentMutationRequest) => Promise<EndgeFacetMutationResult>
}

export type EndgeDomainRepositoryProviderId = 'service-backend' | 'bundle' | 'plain'

/** Публичные возможности активного источника persisted domain. */
export interface EndgeDomainRepositoryCapabilities {
  provider: EndgeDomainRepositoryProviderId
  mutations: boolean
  softDelete: boolean
  restore: boolean
}
