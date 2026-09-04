import type { EndgeBootContext } from '@/kernel/types/bootstrap.types'
import type { DomainCollectionKey } from '@/modules/domain/documents/domain-document-descriptors'
import type { DocumentCreateRequest, DocumentCreateResult } from '@/modules/domain/types/document/document-create.type'
import type { EndgeDomainDocumentMove } from '@/modules/domain/types/document/document-move.type'
import type { DomainDocumentType } from '@/modules/domain/types/document/document.types'
import type {
  EndgeDomainCollection,
  EndgeDomainProvider,
  EndgeDomainRepositoryCapabilities,
} from '@/modules/domain/types/document/domain-provider.type'
import type {
  EndgeDocumentServerState,
  EndgeLiveDomainDocument,
  EndgeLiveDomainSnapshot,
  EndgeWorkspaceServerState,
} from '@/modules/domain/types/document/domain-snapshot.type'

import { AppBus } from '@endge/utils'

import { Endge } from '@/kernel/endge'
import { EndgeModule } from '@/kernel/EndgeModule'
import { resolveEndgeServiceCollection, resolveEndgeServiceStateCollection } from '@/modules/domain-repository/services/domain-provider'
import { getDomainDocumentDescriptor } from '@/modules/domain/documents/domain-document-descriptors'
import { serializeServiceFolder } from '@/modules/domain/documents/service-document-serializer'
import { EndgeDomain_Module, normalizeSnapshotDocuments, normalizeSnapshotFolders } from '@/modules/domain/EndgeDomain_Module'
import { normalizeEntityMeta } from '@/modules/domain/entities/REntity'
import { normalizeEndgeWorkspaceDefinition } from '@/modules/domain/entities/RWorkspace'
import { ComponentType, FilterType, ParameterType, QueryType } from '@/modules/domain/types/document/document.types'

/** Явная ошибка записи через bundle/plain или live backend только для чтения. */
export class EndgeDomainRepositoryReadOnlyError extends Error {
  public readonly code = 'provider_read_only'

  public constructor(provider: string) {
    super(provider === 'service-backend'
      ? 'Service backend mutations are disabled'
      : `Domain repository provider "${provider}" is read-only`)
    this.name = 'EndgeDomainRepositoryReadOnlyError'
  }
}

/** Граница persistence для live service-backend и локальных источников только для чтения. */
export class EndgeDomainRepository_Module extends EndgeModule {
  private _loadedSnapshot: EndgeLiveDomainSnapshot | null = null
  private _domainProvider: EndgeDomainProvider | null = null
  private _domainETag: string | null = null
  private _documentServerState = new Map<string, EndgeDocumentServerState>()
  private _workspaceServerState: EndgeWorkspaceServerState | null = null
  private _capabilities: EndgeDomainRepositoryCapabilities = {
    provider: 'service-backend',
    mutations: false,
    softDelete: false,
    restore: false,
  }

  public get capabilities(): EndgeDomainRepositoryCapabilities {
    return { ...this._capabilities }
  }

  public get domainETag(): string | null {
    return this._domainETag
  }

  public get isHealthy(): boolean {
    return this._capabilities.provider !== 'service-backend' || this._loadedSnapshot != null
  }

  public get hasErrors(): boolean {
    return !this.isHealthy
  }

  public override async setup(ctx: EndgeBootContext): Promise<void> {
    if (ctx.dataProvider === 'default') {
      if (!ctx.domainProvider) {
        throw new Error('[EndgeDomainRepository] domainProvider is required for default data provider')
      }
      this._domainProvider = ctx.domainProvider
      this._capabilities = {
        provider: 'service-backend',
        mutations: ctx.domainProvider.capabilities.mutations,
        softDelete: ctx.domainProvider.capabilities.softDelete,
        restore: ctx.domainProvider.capabilities.restore,
      }
      return
    }

    this._domainProvider = null
    if (ctx.dataProvider === 'plain') {
      this._capabilities = { provider: 'plain', mutations: false, softDelete: false, restore: false }
      return
    }
    if (ctx.dataProvider === 'bundle') {
      if (!ctx.bundleSource) {
        throw new Error('[EndgeDomainRepository] bundleSource is required for bundle data provider')
      }
      this._capabilities = { provider: 'bundle', mutations: false, softDelete: false, restore: false }
      return
    }

    throw new Error(`[EndgeDomainRepository] Unsupported data provider: ${String(ctx.dataProvider)}`)
  }

  /** Загружает live snapshot через активный transport provider и индексирует server state. */
  public async loadSnapshot(ctx: EndgeBootContext): Promise<EndgeLiveDomainSnapshot> {
    if (ctx.dataProvider !== 'default') {
      throw new Error('[EndgeDomainRepository] Live snapshot is available only for default data provider')
    }
    const provider = this._serviceProvider()
    const workspaceIdentity = String(ctx.scope.workspaceIdentity ?? '').trim()
    if (!provider) {
      throw new Error('[EndgeDomainRepository] domainProvider is not configured')
    }
    if (!workspaceIdentity) {
      throw new Error('[EndgeDomainRepository] workspaceIdentity is required for live snapshot')
    }

    const snapshot = await provider.loadWorkspace({ workspaceIdentity, signal: ctx.signal })
    this._loadedSnapshot = snapshot
    this._domainETag = provider.etag
    this._workspaceServerState = { ...snapshot.workspace.state }
    this._indexSnapshotServerState(snapshot)
    return snapshot
  }

  public getLoadedSnapshot(): EndgeLiveDomainSnapshot | null {
    return this._loadedSnapshot
  }

  public getDocumentServerState(documentType: string, identity: string): EndgeDocumentServerState | null {
    const collection = this._capabilities.provider === 'service-backend'
      ? resolveEndgeServiceStateCollection(documentType)
      : documentType
    return this._documentServerState.get(this._serverStateKey(collection, identity)) ?? null
  }

  public override reset(): void {
    this._loadedSnapshot = null
    this._domainProvider = null
    this._domainETag = null
    this._workspaceServerState = null
    this._documentServerState.clear()
  }

  public async isDocumentIdentityAvailable(
    documentType: DomainDocumentType,
    identity: string,
  ): Promise<boolean> {
    const normalizedIdentity = identity.trim()
    return normalizedIdentity.length > 0
      && this._getDomainDocumentByType(documentType, normalizedIdentity) == null
  }

  public async createDocument(request: DocumentCreateRequest): Promise<DocumentCreateResult> {
    this._assertMutationsSupported()
    const identity = request.identity.trim()
    if (!identity) {
      throw new Error('Document identity is required.')
    }
    if (!(await this.isDocumentIdentityAvailable(request.documentType, identity))) {
      throw new Error(`Документ "${identity}" уже существует`)
    }

    const model = request.mode === 'model' ? request.model : request.document
    await this.saveDocument(identity, request.documentType, { model })
    return { documentType: request.documentType, identity }
  }

  public async saveDocument(
    documentId: string | number,
    documentType: DomainDocumentType,
    opts?: { model?: unknown, previousIdentity?: string },
  ): Promise<void> {
    this._assertMutationsSupported()
    await this._saveServiceDocument(documentId, documentType, opts)
  }

  public async deleteDocument(
    documentIdOrIdentity: string,
    documentType: DomainDocumentType,
  ): Promise<void> {
    this._assertMutationsSupported()
    if (!this._capabilities.softDelete) {
      throw new EndgeDomainRepositoryReadOnlyError(this._capabilities.provider)
    }

    const provider = this._requireServiceProvider()
    const identity = this._resolveDocumentIdentity(documentIdOrIdentity, documentType)
    const collection = resolveEndgeServiceCollection(documentType)
    const state = this._requireDocumentServerState(collection, identity)
    const result = await provider.softDeleteDocument({
      workspaceIdentity: this._serviceWorkspaceIdentity(),
      collection,
      identity,
      expectedRevision: state.revision,
    })
    if (!result.document.state.deletedAt) {
      throw new Error('[EndgeDomainRepository] Delete response does not contain a tombstone')
    }
    this._domainETag = result.etag
    this._removeDomainDocumentByType(documentType, documentIdOrIdentity)
    this._documentServerState.set(this._serverStateKey(collection, identity), { ...result.document.state })
    this._notifyDomainChanged()
  }

  public async restoreDocument(
    documentIdOrIdentity: string,
    documentType: DomainDocumentType,
  ): Promise<void> {
    this._assertMutationsSupported()
    if (!this._capabilities.restore) {
      throw new EndgeDomainRepositoryReadOnlyError(this._capabilities.provider)
    }

    const provider = this._requireServiceProvider()
    const identity = this._resolveDocumentIdentity(documentIdOrIdentity, documentType)
    const collection = resolveEndgeServiceCollection(documentType)
    const state = this._requireDocumentServerState(collection, identity)
    const result = await provider.restoreDocument({
      workspaceIdentity: this._serviceWorkspaceIdentity(),
      collection,
      identity,
      expectedRevision: state.revision,
    })
    this._domainETag = result.etag
    this._applyServiceDocument(documentType, result.document, documentIdOrIdentity)
  }

  public async changeDocumentFolder(
    documentId: string | number,
    documentType: DomainDocumentType,
    folderIdOrIdentity: string | number | null,
  ): Promise<void> {
    this._assertMutationsSupported()
    const model = this._getDomainDocumentByType(documentType, documentId)
    if (!model) {
      throw new Error(`Документ не найден: ${String(documentId)}`)
    }

    const document = this._serializeDocument(documentType, model)
    const folder = folderIdOrIdentity == null ? null : Endge.domain.getFolder(folderIdOrIdentity)
    document.folderIdentity = folderIdOrIdentity == null
      ? null
      : String((folder as any)?.identity ?? folderIdOrIdentity).trim()
    await this._saveServiceDocument(documentId, documentType, { serializedDocument: document })
  }

  /** Атомарно переносит несколько persisted-документов в одну папку. */
  public async changeDocumentsFolder(
    documents: readonly EndgeDomainDocumentMove[],
    folderIdOrIdentity: string | number,
  ): Promise<number> {
    this._assertMutationsSupported()
    if (documents.length === 0) {
      return 0
    }

    const provider = this._requireServiceProvider()
    if (!provider.moveDocuments) {
      throw new Error('[EndgeDomainRepository] Domain provider does not support atomic document moves')
    }
    const folder = Endge.domain.getFolder(folderIdOrIdentity)
    const folderIdentity = String((folder as any)?.identity ?? folderIdOrIdentity).trim()
    if (!folderIdentity) {
      throw new Error('Папка назначения не найдена')
    }

    const requests = documents.map(({ documentId, documentType }) => {
      const model = this._getDomainDocumentByType(documentType, documentId)
      if (!model) {
        throw new Error(`Документ не найден: ${String(documentId)}`)
      }
      const collection = resolveEndgeServiceCollection(documentType)
      const identity = this._resolveDocumentIdentity(documentId, documentType)
      const state = this._requireDocumentServerState(collection, identity)
      return { collection, identity, expectedRevision: state.revision }
    })
    const result = await provider.moveDocuments({
      workspaceIdentity: this._serviceWorkspaceIdentity(),
      documents: requests,
      folderIdentity,
    })
    if (result.documents.length !== documents.length) {
      throw new Error('[EndgeDomainRepository] Bulk move response does not match request')
    }

    result.documents.forEach((item, index) => {
      const expected = requests[index]!
      const responseIdentity = String(item.document.identity ?? '').trim()
      if (item.collection !== expected.collection || responseIdentity !== expected.identity) {
        throw new Error('[EndgeDomainRepository] Bulk move response document does not match request')
      }
    })
    result.documents.forEach((item, index) => {
      const source = documents[index]!
      this._applyServiceDocument(source.documentType, item.document, source.documentId)
    })
    return result.moved
  }

  public async saveFolder(folderId: string): Promise<void> {
    this._assertMutationsSupported()
    const provider = this._requireServiceProvider()
    const folder = Endge.domain.getFolder(folderId)
    if (!folder) {
      throw new Error(`Папка не найдена: ${folderId}`)
    }

    const document = serializeServiceFolder(folder, this._serializationContext())
    const identity = String(document.identity ?? '').trim()
    const persistedIdentity = this._findServerIdentity('folders', folder.id) || identity
    const state = this._documentServerState.get(this._serverStateKey('folders', persistedIdentity))
    const request = {
      workspaceIdentity: this._serviceWorkspaceIdentity(),
      collection: 'folders' as const,
      identity: persistedIdentity,
      document,
    }
    const result = state
      ? await provider.updateDocument({ ...request, expectedRevision: state.revision })
      : await provider.createDocument(request)
    this._domainETag = result.etag
    this._applyServiceFolder(result.document, folderId)
  }

  public async deleteFolder(folderIdentity: string): Promise<void> {
    this._assertMutationsSupported()
    if (!this._capabilities.softDelete) {
      throw new EndgeDomainRepositoryReadOnlyError(this._capabilities.provider)
    }

    const provider = this._requireServiceProvider()
    const folder = Endge.domain.getFolder(folderIdentity)
    const identity = String((folder as any)?.identity ?? folderIdentity).trim()
    const state = this._requireDocumentServerState('folders', identity)
    const result = await provider.softDeleteDocument({
      workspaceIdentity: this._serviceWorkspaceIdentity(),
      collection: 'folders',
      identity,
      expectedRevision: state.revision,
    })
    if (!result.document.state.deletedAt) {
      throw new Error('[EndgeDomainRepository] Delete response does not contain a folder tombstone')
    }
    this._domainETag = result.etag
    if (folder) {
      Endge.domain.removeFolderById(folder.id)
    }
    this._documentServerState.set(this._serverStateKey('folders', identity), { ...result.document.state })
    this._notifyDomainChanged()
  }

  public async restoreFolder(folderIdentity: string): Promise<void> {
    this._assertMutationsSupported()
    if (!this._capabilities.restore) {
      throw new EndgeDomainRepositoryReadOnlyError(this._capabilities.provider)
    }

    const provider = this._requireServiceProvider()
    const folder = Endge.domain.getFolder(folderIdentity)
    const identity = String((folder as any)?.identity ?? folderIdentity).trim()
    const state = this._requireDocumentServerState('folders', identity)
    const result = await provider.restoreDocument({
      workspaceIdentity: this._serviceWorkspaceIdentity(),
      collection: 'folders',
      identity,
      expectedRevision: state.revision,
    })
    this._domainETag = result.etag
    this._applyServiceFolder(result.document, folderIdentity)
  }

  public toJSON(): Record<string, unknown> {
    return {
      isHealthy: this.isHealthy,
      capabilities: this.capabilities,
      domainETag: this.domainETag,
    }
  }

  private _indexSnapshotServerState(snapshot: EndgeLiveDomainSnapshot): void {
    this._documentServerState.clear()
    for (const [documentType, documents] of Object.entries(snapshot.documents)) {
      for (const document of documents) {
        const identity = String(document.identity ?? '').trim()
        if (identity) {
          this._documentServerState.set(this._serverStateKey(documentType, identity), { ...document.state })
        }
      }
    }
  }

  private _serverStateKey(documentType: string, identity: string): string {
    return `${documentType}:${identity}`
  }

  private _requireDocumentServerState(
    collection: EndgeDomainCollection,
    identity: string,
  ): EndgeDocumentServerState {
    const state = this._documentServerState.get(this._serverStateKey(collection, identity))
    if (!state) {
      throw new Error(`Server state не найден для ${collection}/${identity}`)
    }
    return state
  }

  private _findServerIdentity(collection: EndgeDomainCollection, documentId: string | number): string | null {
    const id = String(documentId)
    const prefix = `${collection}:`
    for (const [key, state] of this._documentServerState) {
      if (key.startsWith(prefix) && String(state.id) === id) {
        return key.slice(prefix.length)
      }
    }
    return null
  }

  private _assertMutationsSupported(): void {
    if (!this._capabilities.mutations) {
      throw new EndgeDomainRepositoryReadOnlyError(this._capabilities.provider)
    }
  }

  private _serviceProvider(): EndgeDomainProvider | null {
    return this._capabilities.provider === 'service-backend' ? this._domainProvider : null
  }

  private _requireServiceProvider(): EndgeDomainProvider {
    const provider = this._serviceProvider()
    if (!provider) {
      throw new Error('[EndgeDomainRepository] Service domain provider is unavailable')
    }
    return provider
  }

  private _serviceWorkspaceIdentity(): string {
    const identity = String(
      this._loadedSnapshot?.workspace.identity
      ?? (Endge.workspace.isLoaded ? Endge.workspace.current.identity : ''),
    ).trim()
    if (!identity) {
      throw new Error('[EndgeDomainRepository] Service workspace identity is unavailable')
    }
    return identity
  }

  private _serviceFolderIds(): Map<string, string> {
    const result = new Map<string, string>()
    for (const folder of Endge.domain.getFolders()) {
      const identity = String((folder as any).identity ?? '').trim()
      const id = String((folder as any).id ?? '').trim()
      if (identity && id) {
        result.set(identity, id)
      }
    }
    return result
  }

  private async _saveServiceDocument(
    documentId: string | number,
    documentType: DomainDocumentType,
    opts?: { model?: unknown, previousIdentity?: string, serializedDocument?: Record<string, unknown> },
  ): Promise<void> {
    const provider = this._requireServiceProvider()

    if (documentType === 'workspace') {
      const workspace = normalizeEndgeWorkspaceDefinition(opts?.model ?? Endge.workspace.current)
      const state = this._workspaceServerState
      if (!state) {
        throw new Error('[EndgeDomainRepository] Workspace server state is unavailable')
      }
      const result = await provider.updateWorkspace({
        workspaceIdentity: this._serviceWorkspaceIdentity(),
        expectedRevision: state.revision,
        document: {
          identity: workspace.identity,
          displayName: workspace.displayName,
          dataMode: workspace.dataMode === 'mock' ? 'development' : 'production',
          configuration: workspace.configuration,
          meta: normalizeEntityMeta(workspace.meta),
        },
      })
      this._workspaceServerState = { ...result.workspace.state }
      this._domainETag = result.etag
      Endge.workspace.apply(normalizeEndgeWorkspaceDefinition({
        ...result.workspace,
        dataMode: result.workspace.dataMode === 'development' ? 'mock' : 'live',
      }))
      this._notifyDomainChanged()
      return
    }

    const model = opts?.model ?? this._getDomainDocumentByType(documentType, documentId)
    if (!model) {
      throw new Error(`Документ не найден: ${String(documentId)}`)
    }
    const document = opts?.serializedDocument ?? this._serializeDocument(documentType, model)
    const identity = String(document.identity ?? '').trim()
    const collection = resolveEndgeServiceCollection(documentType)
    const persistedIdentity = String(opts?.previousIdentity ?? '').trim()
      || this._findServerIdentity(collection, documentId)
      || String((this._getDomainDocumentByType(documentType, documentId) as any)?.identity ?? identity).trim()
    const state = this._documentServerState.get(this._serverStateKey(collection, persistedIdentity))
    const request = {
      workspaceIdentity: this._serviceWorkspaceIdentity(),
      collection,
      identity: persistedIdentity || identity,
      document,
    }
    const result = state
      ? await provider.updateDocument({ ...request, expectedRevision: state.revision })
      : await provider.createDocument(request)
    this._domainETag = result.etag
    this._applyServiceDocument(documentType, result.document, documentId, state ? persistedIdentity : undefined)
  }

  private _applyServiceDocument(
    documentType: DomainDocumentType,
    document: EndgeLiveDomainDocument,
    replaceRef?: string | number,
    previousIdentity?: string,
  ): void {
    const collection = resolveEndgeServiceCollection(documentType)
    const identity = String(document.identity ?? '').trim()
    const current = replaceRef == null
      ? null
      : this._getDomainDocumentByType(documentType, replaceRef)
        ?? (previousIdentity ? this._getDomainDocumentByType(documentType, previousIdentity) : null)
    const persistedIdentity = String((current as any)?.identity ?? previousIdentity ?? replaceRef ?? '').trim()

    if (persistedIdentity && persistedIdentity !== identity) {
      this._documentServerState.delete(this._serverStateKey(collection, persistedIdentity))
    }

    const key = this._getDomainCollectionKey(documentType)
    const plain = normalizeSnapshotDocuments([document], this._serviceFolderIds())[0]
    const next = getDomainDocumentDescriptor(documentType).materialize(plain)
    const parsed = EndgeDomain_Module.parsePlain({})
    ;(parsed[key] as unknown[]).push(next)
    if (current) {
      Endge.domain.replacePersistedEntity(current, next)
    }
    else { Endge.domain.importFromSchema(parsed) }
    this._documentServerState.set(this._serverStateKey(collection, identity), { ...document.state })
    this._notifyDomainChanged()
  }

  private _applyServiceFolder(document: EndgeLiveDomainDocument, replaceRef?: string | number): void {
    const identity = String(document.identity ?? '').trim()
    const existing = replaceRef == null ? null : Endge.domain.getFolder(replaceRef)
    const previousIdentity = String((existing as any)?.identity ?? replaceRef ?? '').trim()
    if (existing) {
      Endge.domain.removeFolderById(existing.id)
    }
    if (previousIdentity && previousIdentity !== identity) {
      this._documentServerState.delete(this._serverStateKey('folders', previousIdentity))
    }

    const folderIds = this._serviceFolderIds()
    folderIds.set(identity, document.state.id)
    const plain = normalizeSnapshotFolders([document], folderIds)[0]
    Endge.domain.merge({ folders: [plain] })
    this._documentServerState.set(this._serverStateKey('folders', identity), { ...document.state })
    this._notifyDomainChanged()
  }

  private _resolveDocumentIdentity(
    documentIdOrIdentity: string | number,
    documentType: DomainDocumentType,
  ): string {
    const document = this._getDomainDocumentByType(documentType, documentIdOrIdentity)
    return String((document as any)?.identity ?? documentIdOrIdentity)
  }

  private _getDomainDocumentByType(
    documentType: DomainDocumentType,
    documentIdOrIdentity: string | number,
  ): any | null {
    const domain = Endge.domain
    if (documentType === ComponentType.SFC) {
      return domain.getComponentSFC(documentIdOrIdentity)
    }
    if (documentType === ComponentType.Table || documentType === ComponentType.DSL) {
      return domain.getComponent(documentIdOrIdentity)
    }
    if (documentType === QueryType.REST || documentType === QueryType.GraphQL || documentType === QueryType.Custom) {
      return domain.getQuery(documentIdOrIdentity)
    }
    if (documentType === 'data-view') {
      return domain.getDataView(documentIdOrIdentity)
    }
    if (documentType === 'composition') {
      return domain.getComposition(documentIdOrIdentity)
    }
    if (documentType === 'store') {
      return domain.getStore(documentIdOrIdentity)
    }
    if (documentType === 'stream') {
      return domain.getStream(documentIdOrIdentity)
    }
    if (documentType === 'update') {
      return domain.getUpdate(documentIdOrIdentity)
    }
    if (documentType === 'mock') {
      return domain.getMock(documentIdOrIdentity)
    }
    if (documentType === ParameterType.DefaultParameter) {
      return domain.getParameter(documentIdOrIdentity)
    }
    if (documentType === FilterType.DefaultFilter) {
      return domain.getFilter(documentIdOrIdentity)
    }
    if (documentType === 'type' || documentType === 'primitive') {
      return domain.getType(documentIdOrIdentity)
    }
    if (documentType === 'action') {
      return domain.getAction(documentIdOrIdentity)
    }
    if (documentType === 'converter') {
      return domain.getConverter(documentIdOrIdentity)
    }
    if (documentType === 'computation') {
      return domain.getComputation(documentIdOrIdentity)
    }
    if (documentType === 'integration') {
      return domain.getIntegration(documentIdOrIdentity)
    }
    if (documentType === 'environment') {
      return domain.getEnvironment(documentIdOrIdentity)
    }
    if (documentType === 'tenant') {
      return domain.getTenant(documentIdOrIdentity)
    }
    if (documentType === 'policy') {
      return domain.getPolicy(documentIdOrIdentity)
    }
    if (documentType === 'style') {
      return domain.getStyle(documentIdOrIdentity)
    }
    if (documentType === 'configuration') {
      return domain.getConfiguration(documentIdOrIdentity)
    }
    if (documentType === 'page-template') {
      return domain.getPageTemplate(documentIdOrIdentity)
    }
    if (documentType === 'page') {
      return domain.getPage(documentIdOrIdentity)
    }
    if (documentType === 'navigation') {
      return domain.getNavigation(documentIdOrIdentity)
    }
    if (documentType === 'vocabs') {
      return domain.getVocab(documentIdOrIdentity)
    }
    if (documentType === 'auth-profile') {
      return domain.getAuthProfile(documentIdOrIdentity)
    }
    if (documentType === 'i18n-bundles') {
      return domain.getI18nBundle(documentIdOrIdentity)
    }
    if (documentType === 'project') {
      return domain.getProject(documentIdOrIdentity)
    }
    return null
  }

  private _removeDomainDocumentByType(
    documentType: DomainDocumentType,
    documentIdOrIdentity: string | number,
  ): void {
    const existing = this._getDomainDocumentByType(documentType, documentIdOrIdentity)
    if (!existing) {
      return
    }

    const id = (existing as any).id
    const identity = String((existing as any).identity ?? '')
    const remove = (removeById: (value: any) => void, removeByIdentity: (value: string) => void) => {
      if (id != null) {
        removeById(id)
      }
      else if (identity) {
        removeByIdentity(identity)
      }
    }
    const domain = Endge.domain

    if (documentType === ComponentType.SFC) {
      return remove(x => domain.removeComponentSFCById(x), x => domain.removeComponentSFC(x))
    }
    if (documentType === ComponentType.Table || documentType === ComponentType.DSL) {
      return remove(x => domain.removeComponentById(x), x => domain.removeComponent(x))
    }
    if (documentType === QueryType.REST || documentType === QueryType.GraphQL || documentType === QueryType.Custom) {
      return remove(x => domain.removeQueryById(x), x => domain.removeQuery(x))
    }
    if (documentType === 'data-view') {
      return remove(x => domain.removeDataViewById(x), x => domain.removeDataView(x))
    }
    if (documentType === 'composition') {
      return remove(x => domain.removeCompositionById(x), x => domain.removeComposition(x))
    }
    if (documentType === 'store') {
      return remove(x => domain.removeStoreById(x), x => domain.removeStore(x))
    }
    if (documentType === 'stream') {
      return remove(x => domain.removeStreamById(x), x => domain.removeStream(x))
    }
    if (documentType === 'update') {
      return remove(x => domain.removeUpdateById(x), x => domain.removeUpdate(x))
    }
    if (documentType === 'mock') {
      return remove(x => domain.removeMockById(x), x => domain.removeMock(x))
    }
    if (documentType === 'computation') {
      return remove(x => domain.removeComputationById(x), x => domain.removeComputation(x))
    }
    if (documentType === ParameterType.DefaultParameter) {
      return remove(x => domain.removeParameterById(x), x => domain.removeParameter(x))
    }
    if (documentType === FilterType.DefaultFilter) {
      return remove(x => domain.removeFilterById(x), x => domain.removeFilter(x))
    }
    if (documentType === 'type' || documentType === 'primitive') {
      return remove(x => domain.removeTypeById(x), x => domain.removeType(x))
    }
    if (documentType === 'action') {
      return remove(x => domain.removeActionById(x), x => domain.removeAction(x))
    }
    if (documentType === 'converter') {
      return remove(x => domain.removeConverterById(x), x => domain.removeConverter(x))
    }
    if (documentType === 'integration') {
      return remove(x => domain.removeIntegrationById(x), x => domain.removeIntegration(x))
    }
    if (documentType === 'environment') {
      return remove(x => domain.removeEnvironmentById(x), x => domain.removeEnvironment(x))
    }
    if (documentType === 'tenant') {
      return remove(x => domain.removeTenantById(x), x => domain.removeTenant(x))
    }
    if (documentType === 'policy') {
      return remove(x => domain.removePolicyById(x), x => domain.removePolicy(x))
    }
    if (documentType === 'style') {
      return remove(x => domain.removeStyleById(x), x => domain.removeStyle(x))
    }
    if (documentType === 'configuration') {
      return remove(x => domain.removeConfigurationById(x), x => domain.removeConfiguration(x))
    }
    if (documentType === 'page-template') {
      return remove(x => domain.removePageTemplateById(x), x => domain.removePageTemplate(x))
    }
    if (documentType === 'page') {
      return remove(x => domain.removePageById(x), x => domain.removePage(x))
    }
    if (documentType === 'navigation') {
      return remove(x => domain.removeNavigationById(x), x => domain.removeNavigation(x))
    }
    if (documentType === 'vocabs') {
      return remove(x => domain.removeVocabsById(x), x => domain.removeVocabs(x))
    }
    if (documentType === 'auth-profile') {
      return remove(x => domain.removeAuthProfileById(x), x => domain.removeAuthProfile(x))
    }
    if (documentType === 'i18n-bundles') {
      return remove(x => domain.removeI18nBundlesById(x), x => domain.removeI18nBundles(x))
    }
    if (documentType === 'project') {
      return remove(x => domain.removeProjectById(x), x => domain.removeProject(x))
    }
  }

  private _getDomainCollectionKey(documentType: DomainDocumentType): DomainCollectionKey {
    const key = getDomainDocumentDescriptor(documentType).domainCollection
    if (!key) {
      throw new Error(`[EndgeDomainRepository] Unsupported service document type: ${documentType}`)
    }
    return key
  }

  private _notifyDomainChanged(): void {
    ;(AppBus.emit as (event: string, payload?: unknown) => void)('domainChanged', undefined)
  }

  /** Собирает явные lookup-зависимости чистой Domain-сериализации. */
  private _serializationContext() {
    return {
      resolveFolderIdentity: (value: string | number) => Endge.domain.getFolder(value)?.identity ?? null,
      resolveNavigationIdentity: (value: string | number) => Endge.domain.getNavigation(value)?.identity ?? null,
      resolveEnvironmentIdentity: (value: string | number) => Endge.domain.getEnvironment(value)?.identity ?? null,
    }
  }

  /** Сериализует persisted document через его канонический Domain descriptor. */
  private _serializeDocument(documentType: DomainDocumentType, model: unknown): Record<string, unknown> {
    const persistence = getDomainDocumentDescriptor(documentType).persistence
    if (!persistence) {
      throw new Error(`[EndgeDomainRepository] Document type is not persisted: ${documentType}`)
    }
    return persistence.serialize(model, this._serializationContext())
  }
}
