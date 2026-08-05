import type {
  EndgeDomainBundle,
  EndgePortableDocuments,
} from '@/domain/types/document/domain-export.type'

/** Безопасная публичная ссылка на автора server-side изменения. */
export interface EndgeSnapshotActor {
  id: string
  username?: string
  displayName?: string
}

/** Server-only состояние документа, не являющееся частью доменной конфигурации. */
export interface EndgeDocumentServerState {
  id: string
  revision: number
  deletedAt?: string
  createdBy?: EndgeSnapshotActor
  updatedBy?: EndgeSnapshotActor
  createdAt?: string
  updatedAt?: string
}

/** Server-only состояние workspace. */
export interface EndgeWorkspaceServerState extends EndgeDocumentServerState {
  generation: string
  headSequence: number
}

/** Документ live snapshot с обязательным server-side состоянием. */
export type EndgeLiveDomainDocument = Record<string, unknown> & {
  state: EndgeDocumentServerState
}

/** Коллекции документов live snapshot нового backend. */
export type EndgeLivePortableDocuments = {
  [K in keyof EndgePortableDocuments]: EndgeLiveDomainDocument[]
}

/** Консистентный live snapshot одного workspace. */
export type EndgeLiveDomainSnapshot = Omit<EndgeDomainBundle, 'documents' | 'workspace'> & {
  workspace: EndgeDomainBundle['workspace'] & {
    state: EndgeWorkspaceServerState
  }
  documents: EndgeLivePortableDocuments
}
