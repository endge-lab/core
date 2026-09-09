import type { RuntimeEntityType } from '@/features/core/modules/runtime/domain/runtime-entity-map.types'
import type { RuntimeExecuteOptions } from '@/features/core/modules/runtime/domain/runtime-execute.type'
import type { DestroyedRuntimeHostSnapshot, RuntimeArtifactReader, RuntimeHost, RuntimeInspectionLease } from '@/features/core/modules/runtime/domain/runtime-host.types'
import type { AnyRuntimeHost, AnyRuntimeStrategy } from '@/features/core/modules/runtime/domain/runtime-strategy.types'
import type { EndgeRuntimeRaphSnapshot, EndgeRuntimeSnapshot, RuntimeExecutableModel } from '@/features/core/modules/runtime/domain/runtime.types'
import type { RuntimeAppScopeOptions } from '@/features/core/modules/runtime/RuntimeAppScope'

import type { CompositionProgramPayload } from '@/features/core/modules/source/domain/types/composition-source.types'

import type { EndgeDataMode } from '@/features/core/modules/workspace/domain/workspace.types'
import { Raph, RaphNode } from '@endge/raph'
import { STORAGE_VARS_KEY } from '@/features/core/kernel/config/kernel.config'
import { Endge } from '@/features/core/kernel/endge'
import { EndgeRuntimeScopes_Module } from '@/features/core/modules/runtime/EndgeRuntimeScopes_Module'
import { EndgeComposition } from '@/features/core/modules/runtime/execution/endge-composition'
import { EndgeDataView } from '@/features/core/modules/runtime/execution/endge-data-view'
import { EndgeProject } from '@/features/core/modules/runtime/execution/endge-project'
import { EndgeQuery } from '@/features/core/modules/runtime/execution/endge-query'
import { RuntimeBoundaryUpdatePhase } from '@/features/core/modules/runtime/helpers/raph-phases/runtime-boundary-update-phase'
import { RuntimeNodeUpdatePhase } from '@/features/core/modules/runtime/helpers/raph-phases/runtime-node-update-phase'
import { EndgeOperations_Module } from '@/features/core/modules/runtime/operation/EndgeOperations_Module'
import { RuntimeAppScope } from '@/features/core/modules/runtime/RuntimeAppScope'
import { RuntimeHostRegistry } from '@/features/core/modules/runtime/RuntimeHostRegistry'
import { RuntimeScope } from '@/features/core/modules/runtime/RuntimeScope'
import { RuntimeStrategyRegistry } from '@/features/core/modules/runtime/services/RuntimeStrategyRegistry'
import { ActionRuntimeStrategy } from '@/features/core/modules/runtime/services/strategies/ActionRuntimeStrategy'
import { ComponentSFCRuntimeStrategy } from '@/features/core/modules/runtime/services/strategies/ComponentSFCRuntimeStrategy'
import { CompositionRuntimeStrategy } from '@/features/core/modules/runtime/services/strategies/CompositionRuntimeStrategy'
import { FilterRuntimeStrategy } from '@/features/core/modules/runtime/services/strategies/FilterRuntimeStrategy'
import { PageRuntimeStrategy } from '@/features/core/modules/runtime/services/strategies/PageRuntimeStrategy'
import { ProjectRuntimeStrategy } from '@/features/core/modules/runtime/services/strategies/ProjectRuntimeStrategy'
import { QueryRuntimeStrategy } from '@/features/core/modules/runtime/services/strategies/QueryRuntimeStrategy'
import { StoreRuntimeStrategy } from '@/features/core/modules/runtime/services/strategies/StoreRuntimeStrategy'
import { StreamRuntimeStrategy } from '@/features/core/modules/runtime/services/strategies/StreamRuntimeStrategy'
import { EndgeModule } from '@/features/federation/EndgeModule'

/** Модуль создания, регистрации и уничтожения runtime hosts и app scopes. */
export class EndgeRuntime_Module extends EndgeModule {
  public readonly query = new EndgeQuery()
  public readonly dataView = new EndgeDataView()
  public readonly composition = new EndgeComposition()
  public readonly project = new EndgeProject()
  public readonly operations = new EndgeOperations_Module()
  public readonly scopes = new EndgeRuntimeScopes_Module()

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
  private _destroyingRuntimes = new Map<string, Promise<void>>()
  private _destroyingTrees = new Map<string, Promise<void>>()
  private _generation = 0
  private _executions = new Map<string, Promise<unknown>>()

  /** Сохраняет только ограниченные лёгкие описатели для явного inspector. */
  public acquireDestroyedHostSnapshots(limit: number): RuntimeInspectionLease {
    const token = Symbol('destroyed-runtime-host-snapshots')
    this._destroyedSnapshotLeases.set(token, normalizeInspectionLimit(limit))
    this._syncDestroyedSnapshotLimit()
    let released = false
    return {
      release: () => {
        if (released) {
          return
        }
        released = true
        this._destroyedSnapshotLeases.delete(token)
        this._syncDestroyedSnapshotLimit()
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
    this._registerDefaultStrategies()
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
    this._appNode = new RaphNode(Raph.app, {
      id: '__endge.runtime.app',
      meta: { type: 'runtime-scope', kind: 'app' },
    })
    Raph.app.addNode(this._appNode)
    Raph.addPhase(RuntimeNodeUpdatePhase.make())
    Raph.addPhase(RuntimeBoundaryUpdatePhase.make())
    this._syncWorkspaceVariablesToRaph()
    this._hydrateRuntimeFilters()
    this._unsubscribeWorkspace = Endge.workspace.subscribe(() => {
      this._syncWorkspaceVariablesToRaph()
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

    const artifactReader = this._resolveArtifactReader(options.artifactReader)
    if (strategy.entityType !== 'page') {
      const artifact = (options.meta?.artifact as import('@/features/core/modules/program/domain/types/program.types').ProgramArtifact | undefined) ?? artifactReader.getArtifact(strategy.entityType, model.id ?? model.identity)
      if (artifact?.diagnostics?.some((item: { code: string }) => item.code === 'program-artifact-stale' || item.code === 'program-dependency-stale')) {
        return null
      }
    }
    this.start()

    const {
      id: explicitRuntimeId,
      instanceId: requestedLocalId,
      parent: parentRef,
      appScope: appScopeRef,
      persistence,
      persistenceKey,
      meta,
    } = options
    const parent = this._resolveParentHost(parentRef)
    const appScope = this._resolveAppScope(appScopeRef, parent)
    this._ensureLifecycleAppScope(appScope)
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
    if (existing && scopeRoot && appScope.collisionPolicy === 'replace') {
      this.destroyRuntimeTree(runtimeId)
    }
    // Synchronous hosts retain synchronous replacement. Never create over async cleanup.
    if (this._hosts.getById(runtimeId) || this._destroyingRuntimes.has(runtimeId)) {
      console.error(`[EndgeRuntime] Runtime host "${runtimeId}" is occupied. Use executeAsync() to await replacement.`)
      return null
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

    if (!this._registerAndActivateHost(host, parent)) {
      host.destroy()
      return null
    }

    this.notify()
    return host
  }

  /** Awaits teardown before reusing a root address; serializes competing replacements. */
  public async executeAsync(
    model: RuntimeExecutableModel,
    options: RuntimeExecuteOptions = {},
  ): Promise<AnyRuntimeHost | null> {
    const strategy = this._strategies.resolve(model)
    if (!strategy) {
      return this.execute(model, options)
    }
    const parent = this._resolveParentHost(options.parent)
    const appScope = this._resolveAppScope(options.appScope, parent)
    const identity = String((model as any)?.identity ?? (model as any)?.id ?? strategy.entityType)
    const address = appScope.allocate({
      entityType: strategy.entityType,
      identity,
      explicitRuntimeId: options.id,
      requestedLocalId: options.instanceId,
      scopeRoot: !parent,
    })
    const id = address.runtimeId
    const generation = this._generation
    const previous = this._executions.get(id) ?? Promise.resolve()
    const execution = previous.catch(() => {}).then(async () => {
      if (generation !== this._generation) {
        throw new DOMException('Runtime was reset.', 'AbortError')
      }
      if (!parent && appScope.collisionPolicy === 'replace') {
        do {
          await this.destroyRuntimeTreeAsync(id)
          if (generation !== this._generation) {
            throw new DOMException('Runtime was reset.', 'AbortError')
          }
        } while (this._hosts.getById(id) || this._destroyingRuntimes.has(id))
      }
      else {
        await this._destroyingRuntimes.get(id)
      }
      if (generation !== this._generation) {
        throw new DOMException('Runtime was reset.', 'AbortError')
      }
      return this.execute(model, { ...options, appScope, id, instanceId: address.localId })
    })
    this._executions.set(id, execution)
    try {
      return await execution
    }
    finally {
      if (this._executions.get(id) === execution) {
        this._executions.delete(id)
      }
    }
  }

  /** Разрешает data mode по ближайшему Composition override с fallback на общий Endge context. */
  public resolveDataMode(host: RuntimeHost<any, any> | null | undefined): EndgeDataMode {
    let current = host ?? null
    while (current) {
      if (current.entityType === 'composition' || current.entityType === 'project') {
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
    this._ensureLifecycleAppScope(scope)
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
    const registered = this._registerAndActivateHost(host, host.parent)
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

  /** Включает hosts, scopes и operation histories в диагностическое дерево Module. */
  public override createDiagnosticsSnapshot(): EndgeRuntimeSnapshot & { operations: unknown } {
    return {
      ...this.snapshot(),
      operations: this.operations.createDiagnosticsSnapshot(),
    }
  }

  /** Возвращает общий snapshot runtime-состояния. */
  public snapshot(): EndgeRuntimeSnapshot {
    return {
      generatedAt: Date.now(),
      ...this._hosts.snapshot(),
      scopes: this.scopes.snapshot(),
    }
  }

  /** Формирует принадлежащую runtime-модулю диагностическую проекцию Raph. */
  public snapshotRaph(options: { includeData: boolean, includeGraph: boolean }): EndgeRuntimeRaphSnapshot {
    const result: EndgeRuntimeRaphSnapshot = {}
    if (options.includeData) {
      result.data = Raph.data
    }
    if (options.includeGraph) {
      const lease = Raph.debug.acquire()
      try {
        Raph.debug.refresh()
        result.graph = {
          runtimeId: Raph.app.id,
          loopEnabled: Raph.app.loopEnabled,
          frame: { ...Raph.app.frame },
          nodes: Raph.debug.getFlat(),
          tree: Raph.debug.getTree(),
          derived: Raph.app.getDerivedSnapshot(),
        }
      }
      finally {
        lease.release()
      }
    }
    return result
  }

  /**
   * Корректно разрушает runtime-host по runtime-id.
   */
  public destroyRuntime(runtimeId: string): void {
    void this._destroyRuntimeInternal(runtimeId, true).catch(error => console.error('[EndgeRuntime] Cleanup failed:', error))
  }

  /**
   * Корректно разрушает runtime-host и всех его дочерних host.
   */
  public destroyRuntimeTree(runtimeId: string): void {
    void this.destroyRuntimeTreeAsync(runtimeId).catch(error => console.error('[EndgeRuntime] Tree cleanup failed:', error))
  }

  /** Concurrent callers await the same tree, including every child's async cleanup. */
  public destroyRuntimeTreeAsync(runtimeId: string): Promise<void> {
    const rootId = String(runtimeId ?? '').trim()
    const pending = this._destroyingTrees.get(rootId)
    if (pending) {
      return pending
    }
    const hosts = this._hosts.getTreePostOrder(rootId).map(id => this._hosts.getById(id)).filter(host => host !== null)
    if (!hosts.length) {
      return this._destroyingRuntimes.get(rootId) ?? Promise.resolve()
    }
    let resolve!: () => void
    let reject!: (error: unknown) => void
    const cleanup = new Promise<void>((done, fail) => {
      resolve = done
      reject = fail
    })
    this._destroyingTrees.set(rootId, cleanup)
    const dispose = async () => {
      const errors: unknown[] = []
      for (const host of [...hosts].reverse()) {
        try {
          const stopping = host.quiesce()
          if (stopping) {
            await stopping
          }
        }
        catch (error) { errors.push(error) }
      }
      for (const host of hosts) {
        try {
          // A delayed caller must never destroy a later host that reused the same id.
          if (this._hosts.getById(host.id) === host) {
            await this._destroyRuntimeInternal(host.id, false)
          }
        }
        catch (error) { errors.push(error) }
      }
      if (errors.length) {
        throw new AggregateError(errors, `[EndgeRuntime] Cleanup failed for "${rootId}".`)
      }
    }
    const finish = () => {
      if (this._destroyingTrees.get(rootId) === cleanup) {
        this._destroyingTrees.delete(rootId)
      }
      this.notify()
    }
    void dispose().then(() => {
      finish()
      resolve()
    }, (error) => {
      finish()
      reject(error)
    })
    return cleanup
  }

  /**
   * Корректно разрушает все зарегистрированные runtime-host.
   */
  public override async reset(): Promise<void> {
    this._generation += 1
    const hostIds = this._hosts.getAll().map(host => host.id)
    const errors: unknown[] = []
    const release = async (dispose: () => unknown) => {
      try {
        await dispose()
      }
      catch (error) { errors.push(error) }
    }
    try {
      this.operations.reset()
    }
    catch (error) { errors.push(error) }
    // Сразу отсоединяем старый реестр и наблюдаем ошибки параллельного teardown.
    const scopesReset = this.scopes.reset().catch((error) => {
      errors.push(error)
    })
    for (const runtimeId of hostIds) {
      await release(() => this._destroyRuntimeInternal(runtimeId, false))
    }
    await scopesReset

    await release(() => Raph.clearPhases())
    if (this._appNode) {
      await release(() => Raph.app.removeNode(this._appNode!))
    }
    this._scopeNodes.clear()
    for (const scope of this._appScopes.values()) {
      await release(() => scope.reset())
    }
    this._appNode = null
    this._inited = false
    const unsubscribeWorkspace = this._unsubscribeWorkspace
    const unsubscribeContext = this._unsubscribeContext
    this._unsubscribeWorkspace = null
    this._unsubscribeContext = null
    await release(() => unsubscribeWorkspace?.())
    await release(() => unsubscribeContext?.())
    this._hosts.clearDeleted()
    await release(() => this.notify())
    if (errors.length) {
      throw new AggregateError(errors, '[EndgeRuntime] Reset cleanup failed.')
    }
  }

  /** Проецирует фактические переменные workspace в runtime namespace Raph. */
  private _syncWorkspaceVariablesToRaph(): void {
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

  /** Восстанавливает сохранённые значения runtime-фильтров независимо от переменных workspace. */
  private _hydrateRuntimeFilters(): void {
    try {
      const store = Endge.context.getState<Record<string, unknown>>('endge.runtime.parameters')
        ?? this._migrateLegacyRuntimeFilters()
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

  /** Однократно переносит прежний глобальный storage runtime-фильтров. */
  private _migrateLegacyRuntimeFilters(): Record<string, unknown> | undefined {
    if (typeof localStorage === 'undefined') {
      return undefined
    }
    try {
      const raw = localStorage.getItem('endge:parameters')
      if (!raw) {
        return undefined
      }
      const store = JSON.parse(raw) as Record<string, unknown>
      if (!store || typeof store !== 'object' || Array.isArray(store)) {
        return undefined
      }
      Endge.context.setState('endge.runtime.parameters', store)
      if (Endge.context.getState('endge.runtime.parameters') !== undefined) {
        localStorage.removeItem('endge:parameters')
      }
      return store
    }
    catch {
      return undefined
    }
  }

  /**
   * Внутренний destroy для host с контролем уведомления подписчиков.
   */
  private _destroyRuntimeInternal(runtimeId: string, shouldNotify: boolean): Promise<void> {
    const id = String(runtimeId ?? '').trim()
    const pending = this._destroyingRuntimes.get(id)
    if (pending) {
      return pending
    }
    const host = this._hosts.getById(id)
    if (!host) {
      return Promise.resolve()
    }
    // Install ownership before invoking any cleanup, including synchronous re-entry.
    let resolve!: () => void
    let reject!: (error: unknown) => void
    const cleanup = new Promise<void>((done, fail) => {
      resolve = done
      reject = fail
    })
    this._destroyingRuntimes.set(id, cleanup)
    void this._disposeHost(host, shouldNotify).then(resolve, reject)
    return cleanup
  }

  private async _disposeHost(host: AnyRuntimeHost, shouldNotify: boolean): Promise<void> {
    const id = host.id
    const destroyedSnapshot = this._createDestroyedSnapshot(host)

    let cleanupError: unknown = null
    try {
      try {
        const stopping = host.quiesce()
        if (stopping) {
          await stopping
        }
      }
      catch (error) {
        cleanupError = error
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
      this._destroyingRuntimes.delete(id)
      if (shouldNotify) {
        this.notify()
      }
    }
    if (cleanupError) {
      throw cleanupError
    }
  }

  private _syncDestroyedSnapshotLimit(): void {
    const effectiveLimit = Math.max(0, ...this._destroyedSnapshotLeases.values())
    this._hosts.setDeletedSnapshotLimit(effectiveLimit)
    this.notify()
  }

  private _createDestroyedSnapshot(host: RuntimeHost<any, any>): DestroyedRuntimeHostSnapshot {
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
  private _registerAndActivateHost(host: AnyRuntimeHost, parent: AnyRuntimeHost | null): boolean {
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
      ;(parent?.node ?? this._ensureScopeNode(String(host.meta.appScopeId ?? 'app')))?.addChild(host.node, { invalidate: false })
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

  /** Лениво пересоздаёт корень жизненного цикла после полного Endge.reset(). */
  private _ensureLifecycleAppScope(appScope: RuntimeAppScope): RuntimeScope {
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
  private _registerDefaultStrategies(): void {
    this.registerStrategy(new CompositionRuntimeStrategy())
    this.registerStrategy(new StoreRuntimeStrategy())
    this.registerStrategy(new StreamRuntimeStrategy(
      (policy, options) => Endge.auth.requests.resolve(policy, options),
    ))
    this.registerStrategy(new FilterRuntimeStrategy())
    this.registerStrategy(new QueryRuntimeStrategy())
    this.registerStrategy(new ComponentSFCRuntimeStrategy())
    this.registerStrategy(new ActionRuntimeStrategy())
    this.registerStrategy(new ProjectRuntimeStrategy())
    this.registerStrategy(new PageRuntimeStrategy())
  }

  /** Разрешает scope запуска: explicit -> parent -> default app. */
  private _resolveAppScope(rawScope: unknown, parent: AnyRuntimeHost | null): RuntimeAppScope {
    if (rawScope instanceof RuntimeAppScope) {
      return rawScope
    }
    const explicitId = typeof rawScope === 'string'
      ? rawScope.trim()
      : rawScope && typeof rawScope === 'object' && 'id' in rawScope
        ? String(rawScope.id ?? '').trim()
        : ''
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
  private _ensureScopeNode(scopeId: string): RaphNode | null {
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
  private _resolveParentHost(rawParent: unknown): AnyRuntimeHost | null {
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
