import type { EndgeDomainBundle } from '../../domain/types/document/domain-export.type'
import type { EndgeDomainProvider } from '../../domain/types/document/domain-provider.type'
import type { EndgeLiveDomainSnapshot } from '../../domain/types/document/domain-snapshot.type'

export type EndgeDomainSource
  = | { kind: 'live', workspaceIdentity: string, backendURL: string }
    | { kind: 'release', workspaceIdentity: string, backendURL: string, releaseIdentity: string }
    | { kind: 'bundle', workspaceIdentity: string, bundleURL: string }

export type EndgeDomainLoadOptions
  = | { dataProvider: 'default', domainProvider: EndgeDomainProvider }
    | { dataProvider: 'bundle', bundleSource: EndgeDomainBundle }

export interface EndgeDomainLoadRequestOptions {
  resolveBootstrapToken?: () => Promise<string | null>
  signal?: AbortSignal
}

const requiredDocumentCollections = [
  'folders',
  'types',
  'queries',
  'data-views',
  'compositions',
  'stores',
  'streams',
  'updates',
  'mocks',
  'components',
  'actions',
  'filters',
  'converters',
  'computations',
  'vocabs',
  'i18n-bundles',
  'auth-profiles',
  'navigations',
  'styles',
] as const

/** Подготавливает источник домена для read-only приложения до запуска ядра. */
export async function resolveEndgeDomainLoadOptions(
  source: EndgeDomainSource,
  options: EndgeDomainLoadRequestOptions = {},
): Promise<EndgeDomainLoadOptions> {
  if (source.kind === 'live') {
    return {
      dataProvider: 'default',
      domainProvider: createReadOnlyProvider(source, options.resolveBootstrapToken),
    }
  }

  const response = source.kind === 'release'
    ? await requestBackend(
        source,
        `/api/v1/releases/${encodeURIComponent(source.releaseIdentity)}/export`,
        options.resolveBootstrapToken,
        options.signal,
      )
    : await fetch(source.bundleURL, {
        signal: options.signal,
        headers: { Accept: 'application/json' },
      })
  const payload = await readDomainResponse(response, options.signal)
  if (!isDomainBundle(payload, source.workspaceIdentity)) {
    throw new Error('[Endge Domain] Source returned an invalid domain bundle')
  }

  return { dataProvider: 'bundle', bundleSource: payload }
}

function createReadOnlyProvider(
  source: Extract<EndgeDomainSource, { kind: 'live' }>,
  resolveBootstrapToken: EndgeDomainLoadRequestOptions['resolveBootstrapToken'],
): EndgeDomainProvider {
  let etag: string | null = null

  return {
    id: 'service-backend',
    capabilities: { snapshot: true, mutations: false, softDelete: false, restore: false },
    get etag() {
      return etag
    },
    async loadWorkspace({ workspaceIdentity, signal }) {
      if (workspaceIdentity !== source.workspaceIdentity) {
        throw new Error('[Endge Domain] Requested workspace does not match configured workspace')
      }

      const response = await requestBackend(source, '/api/v1/domain', resolveBootstrapToken, signal)
      const payload = await readDomainResponse(response, signal)
      if (!isLiveDomainSnapshot(payload, workspaceIdentity)) {
        throw new Error('[Endge Domain] Backend returned an invalid live workspace snapshot')
      }

      etag = response.headers.get('ETag')
      return payload
    },
    createDocument: rejectMutation,
    updateDocument: rejectMutation,
    softDeleteDocument: rejectMutation,
    restoreDocument: rejectMutation,
    moveDocuments: rejectMutation,
    updateWorkspace: rejectMutation,
  }
}

async function requestBackend(
  source: Exclude<EndgeDomainSource, { kind: 'bundle' }>,
  path: string,
  resolveBootstrapToken: EndgeDomainLoadRequestOptions['resolveBootstrapToken'],
  signal?: AbortSignal,
): Promise<Response> {
  signal?.throwIfAborted()
  const token = await resolveBootstrapToken?.()
  signal?.throwIfAborted()

  return fetch(`${source.backendURL.replace(/\/+$/, '')}${path}`, {
    signal,
    headers: {
      'Accept': 'application/json',
      'X-Endge-Workspace': source.workspaceIdentity,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

async function readDomainResponse(response: Response, signal?: AbortSignal): Promise<unknown> {
  const payload: unknown = await response.json().catch(() => null)
  signal?.throwIfAborted()
  if (!response.ok) {
    const code = isRecord(payload) ? readString(payload.code) : ''
    const message = isRecord(payload) ? readString(payload.message) : ''
    throw new Error(`[Endge Domain] ${code || 'request_failed'}: ${message || `HTTP ${response.status}`}`)
  }
  if (!isRecord(payload)) {
    throw new Error('[Endge Domain] Source returned an empty or invalid JSON response')
  }
  return payload
}

async function rejectMutation(): Promise<never> {
  throw new Error('[Endge Domain] Domain mutations are not available in the runtime application')
}

function isDomainBundle(value: unknown, workspaceIdentity: string): value is EndgeDomainBundle {
  if (!isRecord(value)
    || value.kind !== 'workspace-snapshot'
    || typeof value.schemaVersion !== 'number'
    || !Number.isInteger(value.schemaVersion)
    || value.schemaVersion < 1
    || !isRecord(value.workspace)
    || readString(value.workspace.identity) !== workspaceIdentity
    || !isRecord(value.documents)
    || !Array.isArray(value.installedIntegrations)) {
    return false
  }

  const documents = value.documents
  return requiredDocumentCollections.every(key => Array.isArray(documents[key]))
}

function isLiveDomainSnapshot(value: unknown, workspaceIdentity: string): value is EndgeLiveDomainSnapshot {
  if (!isDomainBundle(value, workspaceIdentity)) {
    return false
  }

  const workspace: Record<string, unknown> = { ...value.workspace }
  const state = workspace.state
  if (!isRecord(state)
    || !readString(state.id)
    || !readString(state.generation)
    || !Number.isInteger(state.headSequence)) {
    return false
  }

  return requiredDocumentCollections.every(key => value.documents[key].every(document => (
    isRecord(document)
    && isRecord(document.state)
    && !!readString(document.state.id)
    && Number.isInteger(document.state.revision)
  )))
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
