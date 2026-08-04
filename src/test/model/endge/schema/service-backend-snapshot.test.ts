import type {
  EndgeBootContext,
  EndgeDomainProvider,
  EndgeLiveDomainDocument,
  EndgeLiveDomainSnapshot,
} from '@/main'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ENDGE_DOMAIN_BUNDLE_VERSION } from '@/model/config/domain-bundle'
import { Endge } from '@/model/endge/kernel/endge'
import { EndgeDomain } from '@/model/endge/domain/endge-domain'
import {
  EndgeSchemaProviderReadOnlyError,
  EndgeSchemaStorage,
} from '@/model/endge/schema/endge-schema-database'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

const DOCUMENT_KEYS = [
  'projects',
  'tenants',
  'environments',
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

function liveDocument(identity: string, extra: Record<string, unknown> = {}): EndgeLiveDomainDocument {
  return {
    identity,
    displayName: identity,
    ...extra,
    state: {
      id: `${identity}-server-id`,
      revision: 7,
      createdAt: '2026-08-04T10:00:00Z',
      updatedAt: '2026-08-04T11:00:00Z',
    },
  }
}

function liveSnapshot(): EndgeLiveDomainSnapshot {
  const documents = Object.fromEntries(
    DOCUMENT_KEYS.map(key => [key, [liveDocument(`${key}-item`)]]),
  ) as EndgeLiveDomainSnapshot['documents']
  documents.folders = [liveDocument('folder-root', { parentIdentity: null })]
  documents.environments = [liveDocument('environment-dev')]
  documents.projects = [liveDocument('project-a', {
    folderIdentity: 'folder-root',
    allowedEnvironments: ['environment-dev'],
  })]
  documents.components = [liveDocument('component-sfc-a', {
    folderIdentity: 'folder-root',
    source: '<template />',
  })]

  return {
    kind: 'workspace-snapshot',
    schemaVersion: ENDGE_DOMAIN_BUNDLE_VERSION,
    workspace: {
      identity: 'workspace-a',
      displayName: 'Workspace A',
      dataMode: 'development',
      managedBy: 'user',
      managedById: null,
      meta: {},
      configuration: TEST_ENDGE_WORKSPACE.configuration,
      state: {
        id: 'workspace-server-id',
        generation: 'generation-id',
        headSequence: 4,
        revision: 2,
      },
    },
    installedIntegrations: [{
      identity: 'integration-a',
      version: '1.2.3',
      configuration: {},
    }],
    documents,
  }
}

function defaultContext(provider: EndgeDomainProvider): EndgeBootContext {
  return {
    dataProvider: 'default',
    scope: { workspaceIdentity: 'workspace-a' },
    vars: {},
    domainProvider: provider,
  }
}

describe('service-backend Core provider', () => {
  afterEach(() => vi.restoreAllMocks())

  it('loads exactly one snapshot and keeps ETag plus revision metadata in storage', async () => {
    const snapshot = liveSnapshot()
    const loadWorkspace = vi.fn().mockResolvedValue(snapshot)
    const provider: EndgeDomainProvider = {
      id: 'service-backend',
      capabilities: { snapshot: true, mutations: false },
      etag: '"generation-id:4"',
      loadWorkspace,
    }
    const storage = new EndgeSchemaStorage()

    await storage.setup(defaultContext(provider))
    await storage.load(defaultContext(provider))

    expect(loadWorkspace).toHaveBeenCalledOnce()
    expect(loadWorkspace).toHaveBeenCalledWith({
      workspaceIdentity: 'workspace-a',
      signal: undefined,
    })
    expect(storage.repositories).toBeNull()
    expect(storage.domainETag).toBe('"generation-id:4"')
    expect(storage.capabilities).toEqual({ provider: 'service-backend', mutations: false })
    expect(storage.getDocumentServerState('queries', 'queries-item')).toMatchObject({
      id: 'queries-item-server-id',
      revision: 7,
    })
  })

  it('maps transport collection names and leaves unsupported Core collections empty', () => {
    const snapshot = liveSnapshot()
    const domain = new EndgeDomain()
    const parsePlain = vi.spyOn(EndgeDomain, 'parsePlain').mockReturnValue({} as never)
    vi.spyOn(domain, 'importFromSchema').mockImplementation(() => undefined)

    domain.mergeFromSnapshot(snapshot)

    const plain = parsePlain.mock.calls[0]![0]
    expect(plain.dataViews[0]).toMatchObject({ identity: 'data-views-item' })
    expect(plain.authProfiles[0]).toMatchObject({ identity: 'auth-profiles-item' })
    expect(plain.i18nBundles[0]).toMatchObject({ identity: 'i18n-bundles-item' })
    expect(plain.componentSFCs[0]).toMatchObject({
      id: 'component-sfc-a-server-id',
      identity: 'component-sfc-a',
      folderId: 'folder-root-server-id',
    })
    expect(plain.projects[0]).toMatchObject({
      id: 'project-a-server-id',
      allowedEnvironmentIds: ['environment-dev-server-id'],
    })
    expect(plain.components).toEqual([])
    expect(plain.parameters).toEqual([])
    expect(plain.policies).toEqual([])
    expect(plain.pageTemplates).toEqual([])
    expect(plain.pages).toEqual([])
    expect(plain.integrations).toEqual([])

    const mappedCollections = [
      'projects', 'types', 'queries', 'dataViews', 'compositions', 'stores', 'streams',
      'updates', 'mocks', 'componentSFCs', 'actions', 'filters', 'converters',
      'computations', 'folders', 'environments', 'tenants', 'styles', 'vocabs',
      'authProfiles', 'i18nBundles', 'navigations',
    ]
    for (const collection of mappedCollections)
      expect(plain[collection]).toHaveLength(1)
  })

  it('uses the server UUID as the live document id without copying revision into domain data', () => {
    const snapshot = liveSnapshot()
    for (const key of DOCUMENT_KEYS)
      snapshot.documents[key] = []
    snapshot.documents.components = [liveDocument('component-sfc-a', { source: '<template />' })]
    const domain = new EndgeDomain()

    domain.mergeFromSnapshot(snapshot)

    const component = domain.getComponentSFCByIdentity('component-sfc-a')
    expect(component?.id).toBe('component-sfc-a-server-id')
    expect(component).not.toHaveProperty('revision')
  })

  it('blocks every public mutation before any Payload request', async () => {
    const provider: EndgeDomainProvider = {
      id: 'service-backend',
      capabilities: { snapshot: true, mutations: false },
      etag: null,
      loadWorkspace: vi.fn().mockResolvedValue(liveSnapshot()),
    }
    const storage = new EndgeSchemaStorage()
    const api = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    }
    ;(storage as unknown as { api: typeof api }).api = api
    await storage.setup(defaultContext(provider))

    const mutations = [
      () => storage.createDocument({ documentType: 'query-rest' as never, identity: 'new', mode: 'model', model: {} }),
      () => storage.saveDocument('item', 'query-rest' as never, { model: {} }),
      () => storage.deleteDocument('item', 'query-rest' as never),
      () => storage.deleteDocumentHard('item', 'query-rest' as never),
      () => storage.restoreDocument('item', 'query-rest' as never),
      () => storage.changeDocumentFolder('item', 'query-rest' as never, null),
      () => storage.saveFolder('folder-root'),
      () => storage.deleteFolder('folder-root'),
      () => storage.upsertPayloadDocumentRaw('query-rest' as never, { identity: 'item' }),
    ]

    for (const mutate of mutations) {
      await expect(mutate()).rejects.toMatchObject({
        code: 'provider_read_only',
        message: 'Service backend mutations are not implemented in this migration stage',
      } satisfies Partial<EndgeSchemaProviderReadOnlyError>)
    }
    expect(api.get).not.toHaveBeenCalled()
    expect(api.post).not.toHaveBeenCalled()
    expect(api.patch).not.toHaveBeenCalled()
    expect(api.delete).not.toHaveBeenCalled()
  })

  it('normalizes snapshot workspace without changing runtime tenant or user', () => {
    const snapshot = liveSnapshot()
    const tenantBefore = Endge.context.getCurrentTenant()
    const userBefore = Endge.context.getCurrentUser()
    vi.spyOn(Endge.schema, 'getLoadedSnapshot').mockReturnValue(snapshot)

    Endge.workspace.build({
      dataProvider: 'default',
      scope: { workspaceIdentity: 'workspace-a' },
      vars: {},
    })

    expect(Endge.workspace.current.dataMode).toBe('mock')
    expect(Endge.workspace.current.installedIntegrations).toEqual([{
      integrationId: 'integration-a',
      integrationIdentity: 'integration-a',
      version: '1.2.3',
    }])
    expect(Endge.context.getCurrentTenant()).toBe(tenantBefore)
    expect(Endge.context.getCurrentUser()).toBe(userBefore)
  })
})
