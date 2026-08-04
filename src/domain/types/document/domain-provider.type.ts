import type { EndgeLiveDomainSnapshot } from '@/domain/types/document/domain-snapshot.type'

/** Возможности выбранного источника домена. */
export interface EndgeDomainProviderCapabilities {
  snapshot: true
  mutations: boolean
}

/** Запрос полного состояния workspace. */
export interface EndgeDomainLoadRequest {
  workspaceIdentity: string
  signal?: AbortSignal
}

/** Транспортно-независимый источник полного workspace snapshot. */
export interface EndgeDomainProvider {
  readonly id: string
  readonly capabilities: EndgeDomainProviderCapabilities
  readonly etag: string | null

  loadWorkspace(request: EndgeDomainLoadRequest): Promise<EndgeLiveDomainSnapshot>
}

export type EndgeSchemaProviderId = 'payload' | 'service-backend' | 'plain'

/** Публичные возможности активного schema provider. */
export interface EndgeSchemaCapabilities {
  provider: EndgeSchemaProviderId
  mutations: boolean
}
