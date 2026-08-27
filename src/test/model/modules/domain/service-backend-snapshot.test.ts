import type {
  EndgeBootContext,
  EndgeDomainBundle,
  EndgeDomainProvider,
  EndgeLiveDomainDocument,
  EndgeLiveDomainSnapshot,
} from '@/main'

import type {
  EndgeDomainRepositoryReadOnlyError,
} from '@/model/modules/domain/endge-domain-repository'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENDGE_DOMAIN_BUNDLE_VERSION } from '@/model/config/domain.config'
import { Endge } from '@/model/kernel/endge'
import { EndgeDomain } from '@/model/modules/domain/endge-domain'
import {
  EndgeDomainRepository,
} from '@/model/modules/domain/endge-domain-repository'
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

function releaseBundle(): EndgeDomainBundle {
  const snapshot = liveSnapshot()
  const { state: _workspaceState, ...workspace } = snapshot.workspace
  const documents = Object.fromEntries(DOCUMENT_KEYS.map(key => [
    key,
    snapshot.documents[key].map(({ state: _documentState, ...document }) => document),
  ])) as unknown as EndgeDomainBundle['documents']

  return {
    kind: snapshot.kind,
    schemaVersion: snapshot.schemaVersion,
    workspace,
    installedIntegrations: snapshot.installedIntegrations,
    documents,
  }
}

describe('service-backend Core provider', () => {
  afterEach(() => vi.restoreAllMocks())

  it('loads exactly one snapshot and keeps ETag plus revision metadata in repository', async () => {
    const snapshot = liveSnapshot()
    const loadWorkspace = vi.fn().mockResolvedValue(snapshot)
    const provider: EndgeDomainProvider = {
      id: 'service-backend',
      capabilities: { snapshot: true, mutations: false, softDelete: false, restore: false },
      etag: '"generation-id:4"',
      loadWorkspace,
      createDocument: vi.fn(),
      updateDocument: vi.fn(),
      softDeleteDocument: vi.fn(),
      restoreDocument: vi.fn(),
      moveDocuments: vi.fn(),
      updateWorkspace: vi.fn(),
    }
    const repository = new EndgeDomainRepository()

    await repository.setup(defaultContext(provider))
    await repository.loadSnapshot(defaultContext(provider))

    expect(loadWorkspace).toHaveBeenCalledOnce()
    expect(loadWorkspace).toHaveBeenCalledWith({
      workspaceIdentity: 'workspace-a',
      signal: undefined,
    })
    expect(repository.domainETag).toBe('"generation-id:4"')
    expect(repository.capabilities).toEqual({ provider: 'service-backend', mutations: false, softDelete: false, restore: false })
    expect(repository.getDocumentServerState('queries', 'queries-item')).toMatchObject({
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
      'projects',
      'types',
      'queries',
      'dataViews',
      'compositions',
      'stores',
      'streams',
      'updates',
      'mocks',
      'componentSFCs',
      'actions',
      'filters',
      'converters',
      'computations',
      'folders',
      'environments',
      'tenants',
      'styles',
      'vocabs',
      'authProfiles',
      'i18nBundles',
      'navigations',
    ]
    for (const collection of mappedCollections) {
      expect(plain[collection]).toHaveLength(1)
    }
  })

  it('keeps tombstones in repository state without materializing them in the live domain', async () => {
    const snapshot = liveSnapshot()
    const deletedAction = liveDocument('deleted-action')
    const deletedFolder = liveDocument('deleted-folder', { parentIdentity: 'folder-root' })
    const deletedEnvironment = liveDocument('deleted-environment')
    const deletedAt = '2026-08-18T08:00:00Z'

    deletedAction.state.deletedAt = deletedAt
    deletedFolder.state.deletedAt = deletedAt
    deletedEnvironment.state.deletedAt = deletedAt
    snapshot.documents.actions.push(deletedAction)
    snapshot.documents.folders.push(deletedFolder)
    snapshot.documents.environments.push(deletedEnvironment)

    const provider: EndgeDomainProvider = {
      id: 'service-backend',
      capabilities: { snapshot: true, mutations: false, softDelete: false, restore: false },
      etag: '"generation-id:4"',
      loadWorkspace: vi.fn().mockResolvedValue(snapshot),
      createDocument: vi.fn(),
      updateDocument: vi.fn(),
      softDeleteDocument: vi.fn(),
      restoreDocument: vi.fn(),
      moveDocuments: vi.fn(),
      updateWorkspace: vi.fn(),
    }
    const repository = new EndgeDomainRepository()
    const context = defaultContext(provider)
    await repository.setup(context)
    await repository.loadSnapshot(context)

    const domain = new EndgeDomain()
    domain.mergeFromSnapshot(snapshot)

    expect(repository.getDocumentServerState('actions', 'deleted-action')).toMatchObject({ deletedAt })
    expect(domain.getActionByIdentity('deleted-action')).toBeNull()
    expect(domain.getFolderByIdentity('deleted-folder')).toBeNull()
    expect(domain.getEnvironmentByIdentity('deleted-environment')).toBeNull()
  })

  it('uses the server UUID as the live document id without copying revision into domain data', () => {
    const snapshot = liveSnapshot()
    for (const key of DOCUMENT_KEYS) {
      snapshot.documents[key] = []
    }
    snapshot.documents.components = [liveDocument('component-sfc-a', { source: '<template />' })]
    const domain = new EndgeDomain()

    domain.mergeFromSnapshot(snapshot)

    const component = domain.getComponentSFCByIdentity('component-sfc-a')
    expect(component?.id).toBe('component-sfc-a-server-id')
    expect(component).not.toHaveProperty('revision')
  })

  it('creates a document only through service-backend and applies the returned revision', async () => {
    Endge.domain.reset()
    const snapshot = liveSnapshot()
    for (const key of DOCUMENT_KEYS) {
      snapshot.documents[key] = []
    }
    const createDocument = vi.fn().mockResolvedValue({
      document: liveDocument('query-new', {
        displayName: 'Query new',
        source: 'defineQuery({})',
        sourceVersion: 2,
      }),
      etag: '"generation-id:5"',
    })
    const provider: EndgeDomainProvider = {
      id: 'service-backend',
      capabilities: { snapshot: true, mutations: true, softDelete: true, restore: true },
      etag: '"generation-id:4"',
      loadWorkspace: vi.fn().mockResolvedValue(snapshot),
      createDocument,
      updateDocument: vi.fn(),
      softDeleteDocument: vi.fn(),
      restoreDocument: vi.fn(),
      moveDocuments: vi.fn(),
      updateWorkspace: vi.fn(),
    }
    const repository = new EndgeDomainRepository()
    const context = defaultContext(provider)
    await repository.setup(context)
    await repository.loadSnapshot(context)

    await repository.createDocument({
      documentType: 'query-rest' as never,
      identity: 'query-new',
      mode: 'portable',
      document: {
        identity: 'query-new',
        displayName: 'Query new',
        source: 'defineQuery({})',
        sourceVersion: 2,
      },
    })

    expect(createDocument).toHaveBeenCalledWith(expect.objectContaining({
      workspaceIdentity: 'workspace-a',
      collection: 'queries',
      identity: 'query-new',
    }))
    expect(repository.domainETag).toBe('"generation-id:5"')
    expect(repository.getDocumentServerState('queries', 'query-new')).toMatchObject({
      id: 'query-new-server-id',
      revision: 7,
    })
  })

  it('keeps project order when an updated document is applied to the live domain', async () => {
    Endge.domain.reset()
    const snapshot = liveSnapshot()
    for (const key of DOCUMENT_KEYS) {
      snapshot.documents[key] = []
    }
    snapshot.documents.folders = [liveDocument('folder-root', { parentIdentity: null })]
    snapshot.documents.environments = [liveDocument('environment-dev')]
    snapshot.documents.projects = ['project-a', 'project-b', 'project-c'].map(identity =>
      liveDocument(identity, {
        folderIdentity: 'folder-root',
        allowedEnvironments: ['environment-dev'],
      }),
    )
    const updatedProject = liveDocument('project-b', {
      displayName: 'Project B updated',
      folderIdentity: 'folder-root',
      allowedEnvironments: ['environment-dev'],
    })
    updatedProject.state.revision = 8
    const updateDocument = vi.fn().mockResolvedValue({
      document: updatedProject,
      etag: '"generation-id:5"',
    })
    const provider: EndgeDomainProvider = {
      id: 'service-backend',
      capabilities: { snapshot: true, mutations: true, softDelete: true, restore: true },
      etag: '"generation-id:4"',
      loadWorkspace: vi.fn().mockResolvedValue(snapshot),
      createDocument: vi.fn(),
      updateDocument,
      softDeleteDocument: vi.fn(),
      restoreDocument: vi.fn(),
      moveDocuments: vi.fn(),
      updateWorkspace: vi.fn(),
    }
    const repository = new EndgeDomainRepository()
    const context = defaultContext(provider)
    await repository.setup(context)
    await repository.loadSnapshot(context)
    Endge.domain.mergeFromSnapshot(snapshot)

    await repository.saveDocument('project-b', 'project', {
      model: Endge.domain.getProject('project-b'),
    })

    expect(Endge.domain.getProjects().map(project => project.identity)).toEqual([
      'project-a',
      'project-b',
      'project-c',
    ])
    expect(Endge.domain.getProject('project-b')?.displayName).toBe('Project B updated')
    expect(repository.getDocumentServerState('projects', 'project-b')?.revision).toBe(8)
  })

  it('keeps folderIdentity when a single document is serialized for update', async () => {
    Endge.domain.reset()
    const snapshot = liveSnapshot()
    snapshot.documents.folders.push(liveDocument('folder-target', { parentIdentity: 'folder-root' }))
    const updateDocument = vi.fn().mockResolvedValue({
      document: liveDocument('queries-item', {
        folderIdentity: 'folder-target',
        source: '',
        sourceVersion: 2,
      }),
      etag: '"8"',
    })
    const provider: EndgeDomainProvider = {
      id: 'service-backend',
      capabilities: { snapshot: true, mutations: true, softDelete: true, restore: true },
      etag: null,
      loadWorkspace: vi.fn().mockResolvedValue(snapshot),
      createDocument: vi.fn(),
      updateDocument,
      softDeleteDocument: vi.fn(),
      restoreDocument: vi.fn(),
      moveDocuments: vi.fn(),
      updateWorkspace: vi.fn(),
    }
    const repository = new EndgeDomainRepository()
    const context = defaultContext(provider)
    await repository.setup(context)
    await repository.loadSnapshot(context)

    await repository.changeDocumentFolder('queries-item', 'query-rest' as never, 'folder-target')

    expect(updateDocument).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'queries',
      identity: 'queries-item',
      expectedRevision: 7,
      document: expect.objectContaining({ folderIdentity: 'folder-target' }),
    }))
  })

  it('moves several documents through one provider call and applies every response', async () => {
    Endge.domain.reset()
    const snapshot = liveSnapshot()
    snapshot.documents.folders.push(liveDocument('folder-target', { parentIdentity: 'folder-root' }))
    snapshot.documents.actions = [liveDocument('action-a'), liveDocument('action-b')]
    const movedAction = (identity: string): EndgeLiveDomainDocument => {
      const document = liveDocument(identity, { folderIdentity: 'folder-target' })
      return { ...document, state: { ...document.state, revision: 8 } }
    }
    const moveDocuments = vi.fn().mockResolvedValue({
      documents: [
        { collection: 'actions', document: movedAction('action-a') },
        { collection: 'actions', document: movedAction('action-b') },
      ],
      moved: 2,
    })
    const provider: EndgeDomainProvider = {
      id: 'service-backend',
      capabilities: { snapshot: true, mutations: true, softDelete: true, restore: true },
      etag: null,
      loadWorkspace: vi.fn().mockResolvedValue(snapshot),
      createDocument: vi.fn(),
      updateDocument: vi.fn(),
      softDeleteDocument: vi.fn(),
      restoreDocument: vi.fn(),
      moveDocuments,
      updateWorkspace: vi.fn(),
    }
    const repository = new EndgeDomainRepository()
    const context = defaultContext(provider)
    await repository.setup(context)
    await repository.loadSnapshot(context)

    await expect(repository.changeDocumentsFolder([
      { documentId: 'action-a', documentType: 'action' },
      { documentId: 'action-b', documentType: 'action' },
    ], 'folder-target')).resolves.toBe(2)

    expect(moveDocuments).toHaveBeenCalledOnce()
    expect(moveDocuments).toHaveBeenCalledWith({
      workspaceIdentity: 'workspace-a',
      folderIdentity: 'folder-target',
      documents: [
        { collection: 'actions', identity: 'action-a', expectedRevision: 7 },
        { collection: 'actions', identity: 'action-b', expectedRevision: 7 },
      ],
    })
    expect(repository.getDocumentServerState('actions', 'action-a')?.revision).toBe(8)
    expect(repository.getDocumentServerState('actions', 'action-b')?.revision).toBe(8)
  })

  it('blocks every public mutation when service-backend is read-only', async () => {
    const provider: EndgeDomainProvider = {
      id: 'service-backend',
      capabilities: { snapshot: true, mutations: false, softDelete: false, restore: false },
      etag: null,
      loadWorkspace: vi.fn().mockResolvedValue(liveSnapshot()),
      createDocument: vi.fn(),
      updateDocument: vi.fn(),
      softDeleteDocument: vi.fn(),
      restoreDocument: vi.fn(),
      moveDocuments: vi.fn(),
      updateWorkspace: vi.fn(),
    }
    const repository = new EndgeDomainRepository()
    await repository.setup(defaultContext(provider))

    const mutations = [
      () => repository.createDocument({ documentType: 'query-rest' as never, identity: 'new', mode: 'model', model: {} }),
      () => repository.saveDocument('item', 'query-rest' as never, { model: {} }),
      () => repository.deleteDocument('item', 'query-rest' as never),
      () => repository.restoreDocument('item', 'query-rest' as never),
      () => repository.changeDocumentFolder('item', 'query-rest' as never, null),
      () => repository.changeDocumentsFolder([{ documentId: 'item', documentType: 'query-rest' as never }], 'folder-root'),
      () => repository.saveFolder('folder-root'),
      () => repository.deleteFolder('folder-root'),
    ]

    for (const mutate of mutations) {
      await expect(mutate()).rejects.toMatchObject({
        code: 'provider_read_only',
        message: 'Service backend mutations are disabled',
      } satisfies Partial<EndgeDomainRepositoryReadOnlyError>)
    }
  })

  it('normalizes snapshot workspace without changing runtime tenant or user', () => {
    const snapshot = liveSnapshot()
    const tenantBefore = Endge.context.getCurrentTenant()
    const userBefore = Endge.context.getCurrentUser()
    vi.spyOn(Endge.domainRepository, 'getLoadedSnapshot').mockReturnValue(snapshot)

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

  it('loads an immutable release bundle without service-backend revision state', async () => {
    const bundle = releaseBundle()
    const context: EndgeBootContext = {
      dataProvider: 'bundle',
      scope: { workspaceIdentity: 'workspace-a' },
      vars: {},
      bundleSource: bundle,
    }
    const repository = new EndgeDomainRepository()
    const domain = new EndgeDomain()
    const parsePlain = vi.spyOn(EndgeDomain, 'parsePlain').mockReturnValue({} as never)
    vi.spyOn(domain, 'importFromSchema').mockImplementation(() => undefined)

    await repository.setup(context)
    await domain.load(context)
    Endge.workspace.build(context)

    expect(repository.capabilities).toEqual({
      provider: 'bundle',
      mutations: false,
      softDelete: false,
      restore: false,
    })
    const plain = parsePlain.mock.calls[0]![0]
    expect(plain.componentSFCs[0]).toMatchObject({
      id: 'component-sfc-a',
      identity: 'component-sfc-a',
      folderId: 'folder-root',
    })
    expect(plain.projects[0]).toMatchObject({
      id: 'project-a',
      allowedEnvironmentIds: ['environment-dev'],
    })
    expect(Endge.workspace.current.identity).toBe('workspace-a')
    expect(Endge.workspace.current.dataMode).toBe('mock')
  })
})
