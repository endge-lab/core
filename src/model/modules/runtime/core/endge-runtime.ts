import type { RuntimeAppScopeOptions } from '@/domain/entities/runtime/RuntimeAppScope'
import type { EndgeDataMode } from '@/domain/types/document/workspace.types'
import type { RuntimeEntityType } from '@/domain/types/runtime/runtime-entity-map.types'
import type { RuntimeExecuteOptions } from '@/domain/types/runtime/runtime-execute.type'
import type { DestroyedRuntimeHostSnapshot, RuntimeArtifactReader, RuntimeHost, RuntimeInspectionLease } from '@/domain/types/runtime/runtime-host.types'
import type { AnyRuntimeHost, AnyRuntimeStrategy } from '@/domain/types/runtime/runtime-strategy.types'

import type { EndgeRuntimeSnapshot, RuntimeExecutableModel } from '@/domain/types/runtime/runtime.types'

import type { CompositionProgramPayload } from '@/domain/types/source/composition-source.types'
import { Raph, RaphNode } from '@endge/raph'
import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { RuntimeAppScope } from '@/domain/entities/runtime/RuntimeAppScope'
import { RuntimeHostRegistry } from '@/domain/entities/runtime/RuntimeHostRegistry'
import { RuntimeScope } from '@/domain/entities/runtime/RuntimeScope'
import { RuntimeScopeRegistry } from '@/domain/entities/runtime/RuntimeScopeRegistry'
import { STORAGE_VARS_KEY } from '@/model/config/kernel.config'
import { RuntimeBoundaryUpdatePhase } from '@/model/helpers/raph-phases/runtime-boundary-update-phase'
import { RuntimeNodeUpdatePhase } from '@/model/helpers/raph-phases/runtime-node-update-phase'
import { Endge } from '@/model/kernel/endge'
import { EndgeActions } from '@/model/modules/runtime/core/endge-actions'
import { EndgeComposition } from '@/model/modules/runtime/execution/endge-composition'
import { EndgeComputation } from '@/model/modules/runtime/execution/endge-computation'
import { EndgeConverters } from '@/model/modules/runtime/execution/endge-converters'
import { EndgeDataView } from '@/model/modules/runtime/execution/endge-data-view'
import { EndgeProject } from '@/model/modules/runtime/execution/endge-project'
import { EndgeQuery } from '@/model/modules/runtime/execution/endge-query'
import { EndgeImplementations } from '@/model/modules/runtime/implementation/endge-implementations'
import { EndgeOperations } from '@/model/modules/runtime/operation/endge-operations'
import { RuntimeStrategyRegistry } from '@/model/services/runtime/RuntimeStrategyRegistry'
import { ActionRuntimeStrategy } from '@/model/services/runtime/strategies/ActionRuntimeStrategy'
import { ComponentSFCRuntimeStrategy } from '@/model/services/runtime/strategies/ComponentSFCRuntimeStrategy'
import { CompositionRuntimeStrategy } from '@/model/services/runtime/strategies/CompositionRuntimeStrategy'
import { FilterRuntimeStrategy } from '@/model/services/runtime/strategies/FilterRuntimeStrategy'
import { PageRuntimeStrategy } from '@/model/services/runtime/strategies/PageRuntimeStrategy'
import { ProjectRuntimeStrategy } from '@/model/services/runtime/strategies/ProjectRuntimeStrategy'
import { QueryRuntimeStrategy } from '@/model/services/runtime/strategies/QueryRuntimeStrategy'
import { StoreRuntimeStrategy } from '@/model/services/runtime/strategies/StoreRuntimeStrategy'
import { StreamRuntimeStrategy } from '@/model/services/runtime/strategies/StreamRuntimeStrategy'

/** Модуль создания, регистрации и уничтожения runtime hosts и app scopes. */
export class EndgeRuntime extends EndgeModule {
  public readonly implementations = new EndgeImplementations()
  public readonly computation = new EndgeComputation(this.implementations)
  public readonly converters = new EndgeConverters(this.implementations)
  public readonly query = new EndgeQuery()
  public readonly dataView = new EndgeDataView()
  public readonly composition = new EndgeComposition()
  public readonly project = new EndgeProject()
  public readonly actions = new EndgeActions(this.implementations)
  public readonly operations = new EndgeOperations()
  public readonly scopes = new RuntimeScopeRegistry()

  private _hosts = new RuntimeHostRegistry()
  private _strategies = new RuntimeStrategyRegistry()
  private _inited = false
  private _appNode: RaphNode | null = null
  private _scopeNodes = new Map<string, RaphNode>()
  private _appScopes = new Map<string, RuntimeAppScope>()
  private _defaultAppScope: RuntimeAppScope
  private _unsubscribeWorkspace: (() => void) | null = null
  private _unsubscribeContext: (() => void) | null = null
  private _destroyedSnapshotLeases = new Map<symbol, number>()
  private _destroyingRuntimeIds = new Set<string>()

  /** Retain only bounded lightweight descriptors for an explicit inspector. */
  public acquireDestroyedHostSnapshots(limit: number): RuntimeInspectionLease {
    const token = Symbol('destroyed-runtime-host-snapshots')
    this._destroyedSnapshotLeases.set(token, normalizeInspectionLimit(limit))
    this.syncDestroyedSnapshotLimit()
    let released = false
    return {
      release: () => {
        if (released) {
          return
        }
        released = true
        this._destroyedSnapshotLeases.delete(token)
        this.syncDestroyedSnapshotLimit()
      },
    }
  }

  /** Создаёт default app scope и регистрирует runtime strategies. */
  public constructor() {
    super()
    this._defaultAppScope = this.createAppScope({
      id: 'app',
      rootPath: 'runtime',
      collisionPolicy: 'multi',
      persistence: 'disabled',
    })
    this.registerDefaultStrategies()
  }

  /**
   * Настраивает Raph runtime до загрузки и сборки домена.
   */
  public override setup(): void {
  }

  /**
   * Регистрирует runtime-фазы в Raph один раз.
   */
  public override start(): void {
    if (this._inited) {
      return
    }
    this._inited = true
    this.converters.start()

    this._appNode = new RaphNode(Raph.app, {
      id: '__endge.runtime.app',
      meta: { type: 'runtime-scope', kind: 'app' },
    })
    Raph.app.addNode(this._appNode)
    Raph.addPhase(RuntimeNodeUpdatePhase.make())
    Raph.addPhase(RuntimeBoundaryUpdatePhase.make())
    this.syncWorkspaceVariablesToRaph()
    this.hydrateRuntimeFilters()
    this._unsubscribeWorkspace = Endge.workspace.subscribe(() => {
      this.syncWorkspaceVariablesToRaph()
    })
    this._unsubscribeContext = Endge.context.subscribe(() => {
      this.invalidateApplicationScopes()
    })
  }

  /**
   * Создаёт runtime-host для переданной доменной модели.
   */
  public execute(
    model: RuntimeExecutableModel,
    options: RuntimeExecuteOptions = {},
  ): AnyRuntimeHost | null {
    const strategy = this._strategies.resolve(model)
    if (!strategy) {
      console.error(`[EndgeRuntime] Unsupported runtime model "${String((model as any)?.identity ?? (model as any)?.id ?? 'unknown')}"`)
      return null
    }

    this.start()

    const {
      id: explicitRuntimeId,
      instanceId: requestedLocalId,
      parent: parentRef,
      appScope: appScopeRef,
      artifactReader: artifactReaderRef,
      persistence,
      persistenceKey,
      meta,
    } = options
    const parent = this.resolveParentHost(parentRef)
    const appScope = this.resolveAppScope(appScopeRef, parent)
    this.ensureLifecycleAppScope(appScope)
    const artifactReader = this._resolveArtifactReader(artifactReaderRef)
    const hostMeta: Record<string, any> = { ...(meta ?? {}) }

    const scopeRoot = !parent
    const identity = String((model as any)?.identity ?? (model as any)?.id ?? strategy.entityType)
    const address = appScope.allocate({
      entityType: strategy.entityType,
      identity,
      explicitRuntimeId,
      requestedLocalId,
      scopeRoot,
    })
    const runtimeId = address.runtimeId
    const existing = this._hosts.getById(runtimeId)
    if (existing) {
      if (scopeRoot && appScope.collisionPolicy === 'replace') {
        this.destroyRuntimeTree(runtimeId)
      }
      else {
        console.error(`[EndgeRuntime] Runtime host "${runtimeId}" is already active.`)
        return null
      }
    }
    hostMeta.appScopeId = appScope.id
    hostMeta.appScopeRootPath = appScope.rootPath
    hostMeta.runtimeScopeId = String(hostMeta.runtimeScopeId ?? parent?.meta.runtimeScopeId ?? `runtime-scope:${appScope.id}`)
    hostMeta.runtimeLocalId = address.localId
    hostMeta.runtimePath = address.runtimePath
    hostMeta.scopeRoot = scopeRoot
    hostMeta.persistence = persistence ?? appScope.persistence
    if (persistenceKey !== undefined) {
      hostMeta.persistenceKey = persistenceKey
    }

    const host = strategy.create({
      id: runtimeId,
      model,
      meta: hostMeta,
      parent,
      artifacts: artifactReader,
    })
    if (!host) {
      return null
    }

    if (!this.registerAndActivateHost(host, parent)) {
      host.destroy()
      return null
    }

    this.notify()
    return host
  }

  /** Разрешает data mode по ближайшему Composition override с fallback на общий Endge context. */
  public resolveDataMode(host: RuntimeHost<any, any> | null | undefined): EndgeDataMode {
    let current = host ?? null
    while (current) {
      if (current.entityType === 'composition') {
        const mode = (current.getArtifactPayload() as CompositionProgramPayload | null)?.dataMode
        if (mode === 'mock' || mode === 'live') {
          return mode
        }
      }
      current = current.parent
    }
    return Endge.context.dataMode
  }

  /**
   * Регистрирует стратегию запуска runtime-сущности.
   */
  public registerStrategy(strategy: AnyRuntimeStrategy): void {
    this._strategies.register(strategy)
  }

  /** Создаёт или возвращает именованный root runtime scope приложения. */
  public createAppScope(options: RuntimeAppScopeOptions): RuntimeAppScope {
    const scopeId = String(options.id ?? '').trim()
    const existing = this._appScopes.get(scopeId)
    if (existing) {
      return existing
    }
    const scope = new RuntimeAppScope(this, options)
    this._appScopes.set(scope.id, scope)
    this.ensureLifecycleAppScope(scope)
    return scope
  }

  /** Возвращает lifecycle scope, которому принадлежит RuntimeHost. */
  public getRuntimeScopeByHost(runtimeId: string): RuntimeScope | null {
    return this.scopes.getByRuntime(runtimeId)
  }

  /** Возвращает корневой scope обычного запуска приложения. */
  public getDefaultAppScope(): RuntimeAppScope {
    return this._defaultAppScope
  }

  /** Возвращает зарегистрированный AppScope. */
  public getAppScope(id: string): RuntimeAppScope | null {
    return this._appScopes.get(String(id ?? '').trim()) ?? null
  }

  /**
   * Возвращает runtime-host по его runtime-id.
   */
  public getRuntimeById<T = AnyRuntimeHost>(runtimeId: string): T | null {
    const id = String(runtimeId ?? '').trim()
    if (!id) {
      return null
    }

    return this._hosts.getById(id) as T
  }

  /**
   * Возвращает список всех активных runtime-host.
   */
  public getRuntimeHosts(): AnyRuntimeHost[] {
    return this._hosts.getAll()
  }

  /**
   * Инвалидирует все renderable roots активных application scopes.
   * Операция намеренно coarse-grained: context preferences меняются редко,
   * поэтому отдельный dependency graph на этом этапе не нужен.
   */
  public invalidateApplicationScopes(): void {
    if (!this._inited) {
      return
    }
    Raph.transaction(() => {
      for (const host of this._hosts.getAll()) {
        if (!host.capabilities.includes('renderable') || !host.node) {
          continue
        }
        host.node.dirty(RuntimeNodeUpdatePhase.PHASE_NAME)
      }
    })
  }

  /** Регистрирует host, созданный владельцем составной runtime-сущности. */
  public registerRuntimeHost(host: AnyRuntimeHost): boolean {
    this.start()
    const registered = this.registerAndActivateHost(host, host.parent)
    if (registered) {
      this.notify()
    }
    return registered
  }

  /**
   * Возвращает snapshots удалённых runtime hosts для inspection tools.
   */
  public getDeletedRuntimeHostSnapshots() {
    return this._hosts.getDeletedSnapshots()
  }

  /**
   * Полностью удаляет один snapshot уничтоженного runtime host.
   */
  public removeDeletedRuntimeHostSnapshot(runtimeId: string): void {
    if (this._hosts.removeDeletedSnapshot(runtimeId)) {
      this.notify()
    }
  }

  /**
   * Полностью очищает snapshots уничтоженных runtime hosts.
   */
  public clearDeletedRuntimeHostSnapshots(): void {
    this._hosts.clearDeleted()
    this.notify()
  }

  /**
   * Возвращает runtime-host по доменной сущности.
   */
  public getRuntimeHostsByEntity(
    entityType: RuntimeEntityType,
    entityIdentity: string,
    appScopeId?: string,
  ): AnyRuntimeHost[] {
    const hosts = this._hosts.getByEntity(entityType, entityIdentity)
    const normalizedScopeId = String(appScopeId ?? '').trim()
    return normalizedScopeId
      ? hosts.filter(host => host.meta.appScopeId === normalizedScopeId)
      : hosts
  }

  /**
   * Возвращает общий snapshot runtime-состояния.
   */
  public snapshot(): EndgeRuntimeSnapshot {
    return {
      generatedAt: Date.now(),
      ...this._hosts.snapshot(),
      scopes: this.scopes.snapshot(),
    }
  }

  /**
   * Корректно разрушает runtime-host по runtime-id.
   */
  public destroyRuntime(runtimeId: string): void {
    void this.destroyRuntimeInternal(runtimeId, true)
  }

  /**
   * Корректно разрушает runtime-host и всех его дочерних host.
   */
  public destroyRuntimeTree(runtimeId: string): void {
    const rootId = String(runtimeId ?? '').trim()
    if (!rootId) {
      return
    }

    if (!this._hosts.getById(rootId)) {
      return
    }

    const postOrder = this._hosts.getTreePostOrder(rootId)
    for (const id of [...postOrder].reverse()) {
      void this._hosts.getById(id)?.quiesce()
    }

    for (const id of postOrder) {
      void this.destroyRuntimeInternal(id, false)
    }

    this.notify()
  }

  /** Корректно разрушает runtime tree и ждёт завершения всего teardown. */
  public async destroyRuntimeTreeAsync(runtimeId: string): Promise<void> {
    const rootId = String(runtimeId ?? '').trim()
    if (!rootId || !this._hosts.getById(rootId)) {
      return
    }

    const postOrder = this._hosts.getTreePostOrder(rootId)
    for (const id of [...postOrder].reverse()) {
      await this._hosts.getById(id)?.quiesce()
    }

    for (const id of postOrder) {
      await this.destroyRuntimeInternal(id, false)
    }

    this.notify()
  }

  /**
   * Корректно разрушает все зарегистрированные runtime-host.
   */
  public override async reset(): Promise<void> {
    const hostIds = this._hosts.getAll().map(host => host.id)
    // Detach the old scope registry synchronously. Existing callers that do
    // not await reset can no longer attach a new runtime to a scope being
    // disposed by this reset generation.
    const scopesReset = this.scopes.reset()
    for (const runtimeId of hostIds) {
      await this.destroyRuntimeInternal(runtimeId, false)
    }

    Raph.clearPhases()
    if (this._appNode) {
      Raph.app.removeNode(this._appNode)
    }
    this._scopeNodes.clear()
    for (const scope of this._appScopes.values()) {
      scope.reset()
    }
    this._appNode = null
    this._inited = false
    this._unsubscribeWorkspace?.()
    this._unsubscribeWorkspace = null
    this._unsubscribeContext?.()
    this._unsubscribeContext = null
    this.computation.reset()
    this.converters.reset()
    this.implementations.clear()
    this.actions.reset()
    this._hosts.clearDeleted()

    await scopesReset

    // Единый notify после batch-reset.
    this.notify()
  }

  /** Projects effective workspace variables into the runtime Raph namespace. */
  private syncWorkspaceVariablesToRaph(): void {
    if (!Endge.workspace.isLoaded) {
      return
    }

    for (const variable of Endge.workspace.variables.getAll()) {
      const name = String(variable.name ?? '').trim()
      if (!name) {
        continue
      }
      Raph.app.set(`${STORAGE_VARS_KEY}.${name}`, Endge.workspace.variables.getValue(name))
    }
  }

  /** Restores persisted runtime filter values independently of workspace variables. */
  private hydrateRuntimeFilters(): void {
    if (typeof localStorage === 'undefined') {
      return
    }

    try {
      const raw = localStorage.getItem('endge:parameters')
      if (!raw) {
        return
      }

      const store = JSON.parse(raw) as Record<string, unknown>
      if (!store || typeof store !== 'object') {
        return
      }

      for (const [identity, payload] of Object.entries(store)) {
        if (!identity) {
          continue
        }
        Raph.set(
          identity.startsWith('parameters.') ? identity : `parameters.${identity}`,
          payload,
        )
      }
    }
    catch (error) {
      console.error(`[EndgeRuntime] Failed to hydrate runtime filters: ${errorText(error)}`)
    }
  }

  /**
   * Внутренний destroy для host с контролем уведомления подписчиков.
   */
  private async destroyRuntimeInternal(
    runtimeId: string,
    shouldNotify: boolean,
  ): Promise<void> {
    const id = String(runtimeId ?? '').trim()
    if (!id || this._destroyingRuntimeIds.has(id)) {
      return
    }

    const host = this._hosts.getById(id)
    if (!host) {
      return
    }
    this._destroyingRuntimeIds.add(id)
    const destroyedSnapshot = this.createDestroyedSnapshot(host)

    let cleanupError: unknown = null
    try {
      const quiesceCleanup = host.quiesce()
      if (quiesceCleanup) {
        await quiesceCleanup
      }
      try {
        const strategyCleanup = this._strategies.resolve(host.model)?.destroy?.({ host })
        if (strategyCleanup) {
          await strategyCleanup
        }
      }
      catch (error) {
        cleanupError = error
      }
      this.scopes.detachRuntime(id)
      Endge.context.destroyRuntimeStateController(id)
      try {
        const hostCleanup = host.destroy()
        if (hostCleanup) {
          await hostCleanup
        }
      }
      catch (error) {
        cleanupError ??= error
      }
      this._hosts.removeById(id)
      this._hosts.rememberDeletedSnapshot(destroyedSnapshot)
    }
    finally {
      this._destroyingRuntimeIds.delete(id)
      if (shouldNotify) {
        this.notify()
      }
    }
    if (cleanupError) {
      throw cleanupError
    }
  }

  private syncDestroyedSnapshotLimit(): void {
    const effectiveLimit = Math.max(0, ...this._destroyedSnapshotLeases.values())
    this._hosts.setDeletedSnapshotLimit(effectiveLimit)
    this.notify()
  }

  private createDestroyedSnapshot(host: RuntimeHost<any, any>): DestroyedRuntimeHostSnapshot {
    return {
      id: host.id,
      basePath: host.basePath,
      parentId: host.parent?.id ?? null,
      runtimeType: host.runtimeType,
      capabilities: [...host.capabilities],
      entityType: host.entityType,
      entityIdentity: host.entityIdentity,
      title: host.title,
      previousStatus: host.status,
      status: 'destroyed',
      createdAt: host.createdAt,
      updatedAt: host.updatedAt,
      removedAt: Date.now(),
      resources: host.resources.map(({ payload: _payload, ...descriptor }) => ({ ...descriptor })),
      channels: host.channels.map(channel => ({ ...channel })),
    }
  }

  /** Регистрирует host, подключает infrastructure и только затем активирует его. */
  private registerAndActivateHost(host: AnyRuntimeHost, parent: AnyRuntimeHost | null): boolean {
    if (this._hosts.getById(host.id)) {
      console.error(`[EndgeRuntime] Runtime host "${host.id}" is already active.`)
      return false
    }
    if (host.node) {
      host.node.options({
        meta: {
          type: 'runtime-node',
          kind: 'root',
          runtimeId: host.id,
          entityType: host.entityType,
          entityIdentity: host.entityIdentity,
          parentRuntimeId: parent?.id ?? null,
        },
      })
      ;(parent?.node ?? this.ensureScopeNode(String(host.meta.appScopeId ?? 'app')))?.addChild(host.node, { invalidate: false })
    }
    try {
      this._hosts.register(host)
      this.scopes.attachRuntime(String(host.meta.runtimeScopeId ?? ''), host)
    }
    catch (error) {
      console.error(`[EndgeRuntime] Failed to register runtime host "${host.id}": ${errorText(error)}`)
      this.scopes.detachRuntime(host.id)
      this._hosts.removeById(host.id)
      return false
    }
    try {
      host.attachRuntimeState(Endge.context.createRuntimeStateController({
        runtimeId: host.id,
        storageId: typeof host.meta.persistenceKey === 'string' ? host.meta.persistenceKey : host.id,
        persistence: host.meta.persistence as any,
      }))
      host.create()
    }
    catch (error) {
      this.destroyRuntimeTree(host.id)
      throw error
    }
    return true
  }

  /** Creates the lifecycle root lazily again after a full Endge.reset(). */
  private ensureLifecycleAppScope(appScope: RuntimeAppScope): RuntimeScope {
    const id = `runtime-scope:${appScope.id}`
    const existing = this.scopes.get(id)
    if (existing) {
      return existing
    }
    const scope = this.scopes.register(new RuntimeScope({
      id,
      path: appScope.id,
      boundaryId: `app:${appScope.id}`,
      hooks: {
        destroyRuntime: runtimeId => this.destroyRuntimeTreeAsync(runtimeId),
      },
    }))
    void scope.activate()
    return scope
  }

  /**
   * Регистрирует встроенные стратегии в порядке от специальных к общим.
   */
  private registerDefaultStrategies(): void {
    this.registerStrategy(new CompositionRuntimeStrategy())
    this.registerStrategy(new StoreRuntimeStrategy())
    this.registerStrategy(new StreamRuntimeStrategy())
    this.registerStrategy(new FilterRuntimeStrategy())
    this.registerStrategy(new QueryRuntimeStrategy())
    this.registerStrategy(new ComponentSFCRuntimeStrategy())
    this.registerStrategy(new ActionRuntimeStrategy())
    this.registerStrategy(new ProjectRuntimeStrategy())
    this.registerStrategy(new PageRuntimeStrategy())
  }

  /** Разрешает scope запуска: explicit -> parent -> default app. */
  private resolveAppScope(rawScope: unknown, parent: AnyRuntimeHost | null): RuntimeAppScope {
    if (rawScope instanceof RuntimeAppScope) {
      return rawScope
    }
    const explicitId = typeof rawScope === 'string' ? rawScope.trim() : ''
    if (explicitId) {
      const explicit = this.getAppScope(explicitId)
      if (!explicit) {
        throw new Error(`[EndgeRuntime] AppScope "${explicitId}" is not registered.`)
      }
      return explicit
    }
    const parentScopeId = String(parent?.meta.appScopeId ?? '').trim()
    return this.getAppScope(parentScopeId) ?? this._defaultAppScope
  }

  /** Создаёт Raph graph node для AppScope независимо от data namespace. */
  private ensureScopeNode(scopeId: string): RaphNode | null {
    const scope = this.getAppScope(scopeId) ?? this._defaultAppScope
    const existing = this._scopeNodes.get(scope.id)
    if (existing) {
      return existing
    }
    if (!this._appNode) {
      return null
    }
    const node = new RaphNode(Raph.app, {
      id: `__endge.runtime.scope.${scope.id}`,
      meta: {
        type: 'runtime-scope',
        kind: 'app-scope',
        appScopeId: scope.id,
        rootPath: scope.rootPath,
      },
    })
    Raph.app.addNode(node)
    this._appNode.addChild(node, { invalidate: false })
    this._scopeNodes.set(scope.id, node)
    return node
  }

  /** Разрешает и проверяет явно переданный parent host. */
  private resolveParentHost(rawParent: unknown): AnyRuntimeHost | null {
    if (rawParent === undefined || rawParent === null) {
      return null
    }

    let id = ''
    if (typeof rawParent === 'string') {
      id = rawParent.trim()
    }
    else if (
      typeof rawParent === 'object'
      && rawParent !== null
      && 'id' in rawParent
    ) {
      id = String((rawParent as { id?: unknown }).id ?? '').trim()
    }

    if (!id) {
      throw new Error('[EndgeRuntime] Explicit parent runtime host must have a non-empty id.')
    }

    const parent = this.getRuntimeById(id)
    if (!parent) {
      throw new Error(`[EndgeRuntime] Parent runtime host "${id}" is not registered.`)
    }
    return parent
  }

  /** Разрешает artifact reader и запрещает невалидную явную зависимость. */
  private _resolveArtifactReader(rawReader: unknown): RuntimeArtifactReader {
    if (rawReader === undefined) {
      return Endge.program
    }
    if (!isRuntimeArtifactReader(rawReader)) {
      throw new Error('[EndgeRuntime] Explicit artifactReader must implement getArtifact().')
    }
    return rawReader
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function isRuntimeArtifactReader(value: unknown): value is RuntimeArtifactReader {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as { getArtifact?: unknown }).getArtifact === 'function',
  )
}

function normalizeInspectionLimit(limit: number): number {
  return Math.max(0, Math.floor(Number.isFinite(limit) ? limit : 0))
}
