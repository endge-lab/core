import type {
  EndgeWorkspaceStateBatch,
  EndgeWorkspaceStateBatchResult,
  EndgeWorkspaceStateScope,
  EndgeWorkspaceStateSnapshot,
  EndgeWorkspaceStateTransport,
} from '@/features/core/modules/context/domain/workspace-state.types'

export class EndgeWorkspaceStateRequestError extends Error {
  public constructor(public readonly status: number) {
    super(`[EndgeContext] Workspace persistence returned HTTP ${status}.`)
  }
}

export function createEndgeBackendWorkspaceStateTransport(options: {
  baseUrl: string
  getUserId?: () => string | null
  getHeaders?: () => HeadersInit | Promise<HeadersInit>
}): EndgeWorkspaceStateTransport {
  const base = options.baseUrl.replace(/\/+$/, '')
  async function request<T>(scope: EndgeWorkspaceStateScope, signal: AbortSignal, batch?: EndgeWorkspaceStateBatch): Promise<T> {
    const headers = new Headers(await options.getHeaders?.())
    headers.set('X-Endge-Workspace', scope.workspace)
    if (batch) {
      headers.set('Content-Type', 'application/json')
    }
    const query = new URLSearchParams({ facets: JSON.stringify(scope.facets) })
    if (scope.application) {
      query.set('application', scope.application)
    }
    const response = await fetch(`${base}/api/v1/user-state?${query}`, {
      method: batch ? 'PATCH' : 'GET',
      headers,
      credentials: 'include',
      cache: 'no-store',
      signal,
      body: batch && JSON.stringify(batch),
    })
    if (!response.ok) {
      throw new EndgeWorkspaceStateRequestError(response.status)
    }
    return response.json() as Promise<T>
  }
  return {
    namespace: base,
    async read(scope, signal) {
      const expected = options.getUserId?.()
      const snapshot = await request<EndgeWorkspaceStateSnapshot>(scope, signal)
      if (!snapshot.actorId || !snapshot.partition || snapshot.application !== scope.application
        || (options.getUserId && (!expected || expected !== snapshot.actorId || expected !== options.getUserId()))) {
        throw new EndgeWorkspaceStateRequestError(403)
      }
      return snapshot
    },
    async save(scope, batch, signal) {
      if (options.getUserId && options.getUserId() !== batch.actorId) {
        throw new EndgeWorkspaceStateRequestError(403)
      }
      return request<EndgeWorkspaceStateBatchResult>(scope, signal, batch)
    },
  }
}
