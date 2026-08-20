import type { EndgeLiveDomainSnapshot } from '@/domain/types/document/domain-snapshot.type'
import type { EndgeLiveDomainDocument, EndgeWorkspaceServerState } from '@/domain/types/document/domain-snapshot.type'

/** Канонические коллекции persisted-домена нового backend. */
export type EndgeDomainCollection
  = | 'projects' | 'tenants' | 'environments' | 'folders' | 'types' | 'queries'
    | 'data-views' | 'compositions' | 'stores' | 'streams' | 'updates' | 'mocks'
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

/** Транспортно-независимый источник полного workspace snapshot. */
export interface EndgeDomainProvider {
  readonly id: string
  readonly capabilities: EndgeDomainProviderCapabilities
  readonly etag: string | null

  loadWorkspace(request: EndgeDomainLoadRequest): Promise<EndgeLiveDomainSnapshot>
  createDocument(request: EndgeDocumentMutationRequest): Promise<EndgeDocumentMutationResult>
  updateDocument(request: EndgeDocumentMutationRequest): Promise<EndgeDocumentMutationResult>
  softDeleteDocument(request: EndgeDocumentMutationRequest): Promise<EndgeDocumentMutationResult>
  restoreDocument(request: EndgeDocumentMutationRequest): Promise<EndgeDocumentMutationResult>
  moveDocuments?(request: EndgeDocumentsMoveRequest): Promise<EndgeDocumentsMoveResult>
  updateWorkspace(request: EndgeWorkspaceMutationRequest): Promise<EndgeWorkspaceMutationResult>
}

export type EndgeDomainRepositoryProviderId = 'service-backend' | 'bundle' | 'plain'

/** Публичные возможности активного источника persisted domain. */
export interface EndgeDomainRepositoryCapabilities {
  provider: EndgeDomainRepositoryProviderId
  mutations: boolean
  softDelete: boolean
  restore: boolean
}
