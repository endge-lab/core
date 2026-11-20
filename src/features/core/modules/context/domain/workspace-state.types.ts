import type { EndgeJSONValue } from '@/features/core/modules/source/domain/types/configuration-source.types'

export type EndgeWorkspaceStateDriver = 'local' | 'indexeddb' | 'backend' | 'disabled'

export interface EndgeWorkspaceStateScope {
  workspace: string
  facets: Readonly<Record<string, string>>
}

export interface EndgeWorkspaceStateEntry {
  key: string
  value: EndgeJSONValue
  deleted: boolean
  revision: number
}

export interface EndgeWorkspaceStateSnapshot {
  partition: string
  actorId: string
  resetRevision: number
  entries: EndgeWorkspaceStateEntry[]
}

export interface EndgeWorkspaceStateOperation {
  key: string
  id: string
  baseRevision: number
  value?: EndgeJSONValue
  delete?: true
}

export interface EndgeWorkspaceStateBatch {
  partition: string
  actorId: string
  resetRevision: number
  operations: EndgeWorkspaceStateOperation[]
}

export interface EndgeWorkspaceStateBatchResult {
  resetRevision: number
  results: {
    key: string
    status: 'saved' | 'conflict' | 'reset'
    entry: EndgeWorkspaceStateEntry | null
  }[]
}

export interface EndgeWorkspaceStateTransport {
  namespace: string
  read: (scope: EndgeWorkspaceStateScope, signal: AbortSignal) => Promise<EndgeWorkspaceStateSnapshot>
  save: (scope: EndgeWorkspaceStateScope, batch: EndgeWorkspaceStateBatch, signal: AbortSignal) => Promise<EndgeWorkspaceStateBatchResult>
}

export interface EndgeWorkspaceStateOptions {
  backend?: EndgeWorkspaceStateTransport
  // Stable local identity from the host session, evaluated during boot and session changes.
  account?: () => string | null
  // The server catalog must declare the same extra keys.
  backendKeys?: readonly string[]
}

export interface EndgeWorkspaceStateSyncStatus {
  pending: number
  error: 'network' | 'session' | 'storage' | null
  conflicts: readonly string[]
}
