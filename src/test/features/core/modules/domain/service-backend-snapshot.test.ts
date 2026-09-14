import type {
  EndgeDomainRepositoryReadOnlyError,
} from '@/features/core/modules/domain-repository/EndgeDomainRepository_Module'

import type {
  EndgeBootContext,
  EndgeDomainBundle,
  EndgeDomainProvider,
  EndgeLiveDomainDocument,
  EndgeLiveDomainSnapshot,
} from '@/main'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import {
  EndgeDomainRepository_Module,
} from '@/features/core/modules/domain-repository/EndgeDomainRepository_Module'
import { EndgeDomain_Module } from '@/features/core/modules/domain/EndgeDomain_Module'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

const DOCUMENT_KEYS = [
  'facets',
  'facet-documents',
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
  documents.facets = [liveDocument('region', { icon: 'Globe', color: '#2563eb', position: 0 })]
  documents['facet-documents'] = [liveDocument('east', { facetIdentity: 'region', configuration: { mode: 'inherit', patch: {} } })]
  documents.components = [liveDocument('component-sfc-a', {
    folderIdentity: 'folder-root',
    source: '<template />',
  })]
  documents['auth-profiles'] = [liveDocument('auth-profiles-item', {
    adapterId: 'bearer',
    config: {},
    credentials: {},
  })]

  return {
    kind: 'workspace-snapshot',
    schemaVersion: 1,
    workspace: {
      identity: 'workspace-a',
      displayName: 'Workspace A',
      startupCompositionIdentity: null,
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
    snapshot.documents[key]!.map(({ state: _documentState, ...document }) => document),
  ])) as unknown as EndgeDomainBundle['documents']

  return {
    kind: snapshot.kind,
    schemaVersion: snapshot.schemaVersion,
    workspace,
    installedIntegrations: snapshot.installedIntegrations,
    documents,
  }
}

describe('провайдер Core для service backend', () => {
  afterEach(() => vi.restoreAllMocks())

  it('builds refreshed saved documents and returns their exact provenance without executing Runtime', async () => {
    const snapshot = liveSnapshot()
    snapshot.documents = Object.fromEntries([...DOCUMENT_KEYS, 'simulations', 'configurations'].map(key => [key, []])) as unknown as EndgeLiveDomainSnapshot['documents']
    snapshot.documents.components = [liveDocument('component-sfc-a', { source: '<template />' })]
    const refresh = vi.spyOn(Endge.domainRepository, 'refreshSnapshot').mockResolvedValue(snapshot)
    const build = vi.spyOn(Endge, 'build').mockResolvedValue(undefined)
    const execute = vi.spyOn(Endge.runtime, 'execute')
    try {
      expect(await Endge.buildSavedProgram()).toBe(snapshot)
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(build).toHaveBeenCalledTimes(1)
      expect(Endge.domain.getComponentSFCs().map(value => value.identity)).toContain('component-sfc-a')
      expect(execute).not.toHaveBeenCalled()
      refresh.mockRejectedValueOnce(new Error('network unavailable'))
      const before = Endge.domain.getComponentSFCs()[0]
      await expect(Endge.buildSavedProgram()).rejects.toThrow('network unavailable')
      expect(Endge.domain.getComponentSFCs()[0]).toBe(before)
      expect(build).toHaveBeenCalledTimes(1)
    }
    finally {
      Endge.domain.reset()
    }
  })

  it('загружает ровно один snapshot и хранит ETag и метаданные ревизии в репозитории', async () => {
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
    const repository = new EndgeDomainRepository_Module()

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

  it('сопоставляет имена transport-коллекций и оставляет неподдерживаемые коллекции Core пустыми', () => {
    const snapshot = liveSnapshot()
    const domain = new EndgeDomain_Module()
    const parsePlain = vi.spyOn(EndgeDomain_Module, 'parsePlain').mockReturnValue({} as never)
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
    expect(plain.facets[0]).toMatchObject({ id: 'region-server-id', identity: 'region' })
    expect(plain.facetDocuments[0]).toMatchObject({ identity: 'east', facetIdentity: 'region' })
    expect(plain.components).toEqual([])
    expect(plain.parameters).toEqual([])
    expect(plain.policies).toEqual([])
    expect(plain.pageTemplates).toEqual([])
    expect(plain.pages).toEqual([])
    expect(plain.integrations).toEqual([])

    const mappedCollections = [
      'facets',
      'facetDocuments',
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

  it('хранит tombstones в состоянии репозитория без материализации в live-домене', async () => {
    const snapshot = liveSnapshot()
    const deletedAction = liveDocument('deleted-action')
    const deletedFolder = liveDocument('deleted-folder', { parentIdentity: 'folder-root' })
    const deletedFacetDocument = liveDocument('deleted-region', { facetIdentity: 'region', configuration: { mode: 'inherit', patch: {} } })
    const deletedAt = '2026-08-18T08:00:00Z'

    deletedAction.state.deletedAt = deletedAt
    deletedFolder.state.deletedAt = deletedAt
    deletedFacetDocument.state.deletedAt = deletedAt
    snapshot.documents.actions.push(deletedAction)
    snapshot.documents.folders.push(deletedFolder)
    snapshot.documents['facet-documents']!.push(deletedFacetDocument)

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
    const repository = new EndgeDomainRepository_Module()
    const context = defaultContext(provider)
    await repository.setup(context)
    await repository.loadSnapshot(context)

    const domain = new EndgeDomain_Module()
    domain.mergeFromSnapshot(snapshot)

    expect(repository.getDocumentServerState('actions', 'deleted-action')).toMatchObject({ deletedAt })
    expect(domain.getActionByIdentity('deleted-action')).toBeNull()
    expect(domain.getFolderByIdentity('deleted-folder')).toBeNull()
    expect(domain.getFacetDocument('region', 'deleted-region')).toBeNull()
  })

  it('использует серверный UUID как ID live-документа без копирования ревизии в данные домена', () => {
    const snapshot = liveSnapshot()
    for (const key of DOCUMENT_KEYS) {
      snapshot.documents[key] = []
    }
    snapshot.documents.components = [liveDocument('component-sfc-a', { source: '<template />' })]
    const domain = new EndgeDomain_Module()

    domain.mergeFromSnapshot(snapshot)

    const component = domain.getComponentSFCByIdentity('component-sfc-a')
    expect(component?.id).toBe('component-sfc-a-server-id')
    expect(component).not.toHaveProperty('revision')
  })

  it('создаёт документ только через service backend и применяет возвращённую ревизию', async () => {
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
    const repository = new EndgeDomainRepository_Module()
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

  it('сохраняет порядок Composition при применении обновлённого документа к live-домену', async () => {
    Endge.domain.reset()
    const snapshot = liveSnapshot()
    for (const key of DOCUMENT_KEYS) {
      snapshot.documents[key] = []
    }
    snapshot.documents.folders = [liveDocument('folder-root', { parentIdentity: null })]
    snapshot.documents.compositions = ['composition-a', 'composition-b', 'composition-c'].map(identity =>
      liveDocument(identity, { folderIdentity: 'folder-root', source: 'defineComposition({})', sourceVersion: 1 }),
    )
    const updatedComposition = liveDocument('composition-b', {
      displayName: 'Composition B updated',
      folderIdentity: 'folder-root',
      source: 'defineComposition({})',
      sourceVersion: 1,
    })
    updatedComposition.state.revision = 8
    const updateDocument = vi.fn().mockResolvedValue({
      document: updatedComposition,
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
    const repository = new EndgeDomainRepository_Module()
    const context = defaultContext(provider)
    await repository.setup(context)
    await repository.loadSnapshot(context)
    Endge.domain.mergeFromSnapshot(snapshot)

    await repository.saveDocument('composition-b', 'composition', {
      model: Endge.domain.getComposition('composition-b'),
    })

    expect(Endge.domain.getCompositions().map(composition => composition.identity)).toEqual([
      'composition-a',
      'composition-b',
      'composition-c',
    ])
    expect(Endge.domain.getComposition('composition-b')?.displayName).toBe('Composition B updated')
    expect(repository.getDocumentServerState('compositions', 'composition-b')?.revision).toBe(8)
  })

  it('сохраняет folderIdentity при сериализации одного документа для обновления', async () => {
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
    const repository = new EndgeDomainRepository_Module()
    const context = defaultContext(provider)
    await repository.setup(context)
    await repository.loadSnapshot(context)
    Endge.domain.mergeFromSnapshot(snapshot)

    await repository.changeDocumentFolder('queries-item', 'query-rest' as never, 'folder-target')

    expect(updateDocument).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'queries',
      identity: 'queries-item',
      expectedRevision: 7,
      document: expect.objectContaining({ folderIdentity: 'folder-target' }),
    }))
  })

  it('перемещает несколько документов одним вызовом провайдера и применяет каждый ответ', async () => {
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
    const repository = new EndgeDomainRepository_Module()
    const context = defaultContext(provider)
    await repository.setup(context)
    await repository.loadSnapshot(context)
    Endge.domain.mergeFromSnapshot(snapshot)

    await expect(repository.changeDocumentsFolder([
      { documentId: 'action-a', documentType: 'action' },
      { documentId: 'action-b', documentType: 'action' },
    ], 'folder-target')).resolves.toBe(2)

    expect(moveDocuments).toHaveBeenCalledOnce()
    expect(moveDocuments).toHaveBeenCalledWith({
      workspaceIdentity: 'workspace-a',
      signal: expect.any(AbortSignal),
      folderIdentity: 'folder-target',
      documents: [
        { collection: 'actions', identity: 'action-a', expectedRevision: 7 },
        { collection: 'actions', identity: 'action-b', expectedRevision: 7 },
      ],
    })
    expect(repository.getDocumentServerState('actions', 'action-a')?.revision).toBe(8)
    expect(repository.getDocumentServerState('actions', 'action-b')?.revision).toBe(8)
  })

  it('блокирует каждую публичную мутацию, если service backend доступен только для чтения', async () => {
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
    const repository = new EndgeDomainRepository_Module()
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

  it('нормализует Workspace snapshot без изменения runtime фасетов или пользователя', () => {
    const snapshot = liveSnapshot()
    const facetsBefore = Endge.context.getFacetSelections()
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
    expect(Endge.context.getFacetSelections()).toEqual(facetsBefore)
    expect(Endge.context.getCurrentUser()).toBe(userBefore)
  })

  it('загружает неизменяемый release bundle без состояния ревизии service backend', async () => {
    const bundle = releaseBundle()
    const context: EndgeBootContext = {
      dataProvider: 'bundle',
      scope: { workspaceIdentity: 'workspace-a' },
      vars: {},
      bundleSource: bundle,
    }
    const repository = new EndgeDomainRepository_Module()
    const domain = new EndgeDomain_Module()
    const parsePlain = vi.spyOn(EndgeDomain_Module, 'parsePlain').mockReturnValue({} as never)
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
    expect(plain.facets[0]).toMatchObject({ id: 'region', identity: 'region' })
    expect(Endge.workspace.current.identity).toBe('workspace-a')
    expect(Endge.workspace.current.dataMode).toBe('mock')
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function mutableProvider(snapshot = liveSnapshot()): EndgeDomainProvider {
  return {
    id: 'service-backend',
    capabilities: { snapshot: true, mutations: true, softDelete: true, restore: true },
    etag: 'current',
    loadWorkspace: vi.fn().mockResolvedValue(snapshot),
    createDocument: vi.fn(),
    updateDocument: vi.fn(),
    softDeleteDocument: vi.fn(),
    restoreDocument: vi.fn(),
    moveDocuments: vi.fn(),
    updateWorkspace: vi.fn(),
  }
}

describe('изоляция поколений DomainRepository', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    Endge.domain.reset()
  })

  /** Старый snapshot не должен заменять актуальные revisions после setup/reset. */
  it.each([false, true])('отклоняет старый snapshot, reset=%s', async (reset) => {
    const repository = new EndgeDomainRepository_Module()
    const old = deferred<EndgeLiveDomainSnapshot>()
    const provider = mutableProvider()
    await repository.setup(defaultContext(provider))
    vi.mocked(provider.loadWorkspace).mockReturnValueOnce(old.promise)
    const pending = repository.loadSnapshot(defaultContext(provider))
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    if (reset) {
      await repository.setup(defaultContext(provider))
    }
    const current = liveSnapshot()
    current.workspace.state.revision = 9
    vi.mocked(provider.loadWorkspace).mockResolvedValueOnce(current)
    await repository.loadSnapshot(defaultContext(provider))
    old.resolve(liveSnapshot())
    await rejected
    expect(repository.getLoadedSnapshot()?.workspace.state.revision).toBe(9)
  })

  /** Все виды mutation должны игнорировать транспорт, не подчинившийся AbortSignal. */
  it.each(['save', 'delete', 'restore', 'workspace', 'folder'] as const)('не применяет поздний ответ %s после setup нового контекста', async (operation) => {
    const repository = new EndgeDomainRepository_Module()
    const provider = mutableProvider()
    await repository.setup(defaultContext(provider))
    await repository.loadSnapshot(defaultContext(provider))
    Endge.domain.mergeFromSnapshot(liveSnapshot())
    const response = deferred<any>()
    vi.mocked(provider.updateDocument).mockReturnValue(response.promise)
    vi.mocked(provider.softDeleteDocument).mockReturnValue(response.promise)
    vi.mocked(provider.restoreDocument).mockReturnValue(response.promise)
    vi.mocked(provider.updateWorkspace).mockReturnValue(response.promise)
    const pending = operation === 'save'
      ? repository.saveDocument('compositions-item', 'composition')
      : operation === 'delete'
        ? repository.deleteDocument('compositions-item', 'composition')
        : operation === 'restore'
          ? repository.restoreDocument('compositions-item', 'composition')
          : operation === 'workspace'
            ? repository.saveDocument('workspace-a', 'workspace', { model: TEST_ENDGE_WORKSPACE })
            : repository.saveFolder('folder-root')
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    const calls = [...vi.mocked(provider.updateDocument).mock.calls, ...vi.mocked(provider.softDeleteDocument).mock.calls, ...vi.mocked(provider.restoreDocument).mock.calls, ...vi.mocked(provider.updateWorkspace).mock.calls]
    const signal = calls[0]?.[0].signal
    expect(signal?.aborted).toBe(false)
    const next = mutableProvider()
    await repository.setup(defaultContext(next))
    await repository.loadSnapshot(defaultContext(next))
    const before = Endge.domain.toPlain()
    expect(signal?.aborted).toBe(true)
    response.resolve({ document: liveDocument('compositions-item', { displayName: 'stale' }), workspace: liveSnapshot().workspace, etag: 'stale' })
    await rejected
    expect(Endge.domain.toPlain()).toEqual(before)
    expect(repository.domainETag).toBe('current')
  })

  it('не начинает create в другом контексте после ожидания проверки identity', async () => {
    const repository = new EndgeDomainRepository_Module()
    const provider = mutableProvider()
    await repository.setup(defaultContext(provider))
    const available = deferred<boolean>()
    vi.spyOn(repository, 'isDocumentIdentityAvailable').mockReturnValue(available.promise)
    const pending = repository.createDocument({ documentType: 'type', identity: 'Next', mode: 'model', model: {} })
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await repository.setup(defaultContext(provider))
    available.resolve(true)
    await rejected
    expect(provider.createDocument).not.toHaveBeenCalled()
  })
})
