import type { RuntimeEntityType } from '@/domain/types/runtime/runtime-entity-map.types'
import type { AnyRuntimeStrategy } from '@/domain/types/runtime/runtime-strategy.types'
import type { EndgeRuntimeSnapshot, RuntimeExecutableModel } from '@/domain/types/runtime/runtime.types'

import { Raph, RaphNode } from '@endge/raph'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { RuntimeAppScope, type RuntimeAppScopeOptions } from '@/domain/entities/runtime/RuntimeAppScope'
import { RuntimeHostRegistry } from '@/domain/entities/runtime/RuntimeHostRegistry'
import type { AnyRuntimeHost } from '@/domain/types/runtime/runtime-strategy.types'
import { RuntimeStrategyRegistry } from '@/model/services/runtime/RuntimeStrategyRegistry'
import { ActionRuntimeStrategy } from '@/model/services/runtime/strategies/ActionRuntimeStrategy'
import { ComponentSFCRuntimeStrategy } from '@/model/services/runtime/strategies/ComponentSFCRuntimeStrategy'
import { PageRuntimeStrategy } from '@/model/services/runtime/strategies/PageRuntimeStrategy'
import { ProjectRuntimeStrategy } from '@/model/services/runtime/strategies/ProjectRuntimeStrategy'
import { QueryRuntimeStrategy } from '@/model/services/runtime/strategies/QueryRuntimeStrategy'
import { ViewRuntimeStrategy } from '@/model/services/runtime/strategies/ViewRuntimeStrategy'
import { FilterRuntimeStrategy } from '@/model/services/runtime/strategies/FilterRuntimeStrategy'
import { CompositionRuntimeStrategy } from '@/model/services/runtime/strategies/CompositionRuntimeStrategy'
import { StoreRuntimeStrategy } from '@/model/services/runtime/strategies/StoreRuntimeStrategy'
import { Endge } from '@/model/endge/kernel/endge'
import { RuntimeBoundaryUpdatePhase } from '@/model/helpers/raph-phases/runtime-boundary-update-phase'
import { RuntimeNodeUpdatePhase } from '@/model/helpers/raph-phases/runtime-node-update-phase'
import Config from '@/model/config'
import { EndgeCommands } from '@/model/endge/runtime/core/endge-commands'
import { EndgeComposition } from '@/model/endge/runtime/execution/endge-composition'
import { EndgeDataView } from '@/model/endge/runtime/execution/endge-data-view'
import { EndgeQuery } from '@/model/endge/runtime/execution/endge-query'
import { EndgeFlow } from '@/model/endge/runtime/flow/endge-flow'
import { EndgeFlowRegistry } from '@/model/endge/runtime/flow/endge-flow-registry'

/** Модуль создания, регистрации и уничтожения runtime hosts и app scopes. */
export class EndgeRuntime extends EndgeModule {
  public readonly query = new EndgeQuery()
  public readonly dataView = new EndgeDataView()
  public readonly composition = new EndgeComposition()
  public readonly flowRegistry = new EndgeFlowRegistry()
  public readonly flow = new EndgeFlow(this.flowRegistry)
  public readonly commands = new EndgeCommands()

  private _hosts = new RuntimeHostRegistry()
  private _strategies = new RuntimeStrategyRegistry()
  private _inited = false
  private _appNode: RaphNode | null = null
  private _scopeNodes = new Map<string, RaphNode>()
  private _appScopes = new Map<string, RuntimeAppScope>()
  private _defaultAppScope: RuntimeAppScope
  private _unsubscribeWorkspace: (() => void) | null = null

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
    Raph.options({ debug: true })
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
    this.syncWorkspaceVariablesToRaph()
    this.hydrateRuntimeFilters()
    this._unsubscribeWorkspace = Endge.workspace.subscribe(() => {
      this.syncWorkspaceVariablesToRaph()
    })
  }

  /**
   * Создаёт runtime-host для переданной доменной модели.
   */
  public execute(
    model: RuntimeExecutableModel,
    meta: Record<string, any> = {},
  ): AnyRuntimeHost | null {
    const strategy = this._strategies.resolve(model)
    if (!strategy) {
      console.error('[EndgeRuntime] Unsupported runtime model', model)
      return null
    }
    return this.createHost(strategy, model, meta)
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
    return scope
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

  /** Регистрирует host, созданный владельцем составной runtime-сущности. */
  public registerRuntimeHost(host: AnyRuntimeHost): boolean {
    this.start()
    const registered = this.registerCreatedHost(host, host.parent)
    if (registered)
      this.notify()
    return registered
  }

  /**
   * Возвращает снимки удалённых runtime-host из debug-архива.
   */
  public getDeletedRuntimeHostSnapshots() {
    return this._hosts.getDeletedSnapshots()
  }

  /**
   * Полностью удалить snapshot runtime-host из debug-архива удалённых.
   */
  public removeDeletedRuntimeHostSnapshot(runtimeId: string): void {
    if (!Endge.debug.enabled) {
      return
    }

    if (this._hosts.removeDeletedSnapshot(runtimeId)) {
      this.notify()
    }
  }

  /**
   * Полностью очистить debug-архив удалённых runtime-host.
   */
  public clearDeletedRuntimeHostSnapshots(): void {
    if (!Endge.debug.enabled) {
      return
    }

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
    }
  }

  /**
   * Корректно разрушает runtime-host по runtime-id.
   */
  public destroyRuntime(runtimeId: string): void {
    this.destroyRuntimeInternal(runtimeId, true)
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

    for (const id of this._hosts.getTreePostOrder(rootId)) {
      this.destroyRuntimeInternal(id, false)
    }

    this.notify()
  }

  /**
   * Корректно разрушает все зарегистрированные runtime-host.
   */
  public override reset(): void {
    const hostIds = this._hosts.getAll().map(host => host.id)
    for (const runtimeId of hostIds) {
      this.destroyRuntimeInternal(runtimeId, false)
    }

    Raph.clearPhases()
    if (this._appNode)
      Raph.app.removeNode(this._appNode)
    this._scopeNodes.clear()
    for (const scope of this._appScopes.values())
      scope.reset()
    this._appNode = null
    this._inited = false
    this._unsubscribeWorkspace?.()
    this._unsubscribeWorkspace = null
    this.flowRegistry.reset()
    this.commands.reset()

    // Единый notify после batch-reset.
    this.notify()
  }

  /** Projects effective workspace variables into the runtime Raph namespace. */
  private syncWorkspaceVariablesToRaph(): void {
    if (!Endge.workspace.isLoaded)
      return

    for (const variable of Endge.workspace.variables.getAll()) {
      const name = String(variable.name ?? '').trim()
      if (!name)
        continue
      Raph.app.set(`${Config.STORAGE_VARS_KEY}.${name}`, Endge.workspace.variables.getValue(name))
    }
  }

  /** Restores persisted runtime filter values independently of workspace variables. */
  private hydrateRuntimeFilters(): void {
    if (typeof localStorage === 'undefined')
      return

    try {
      const raw = localStorage.getItem('endge:parameters')
      if (!raw)
        return

      const store = JSON.parse(raw) as Record<string, unknown>
      if (!store || typeof store !== 'object')
        return

      for (const [identity, payload] of Object.entries(store)) {
        if (!identity)
          continue
        Raph.set(
          identity.startsWith('parameters.') ? identity : `parameters.${identity}`,
          payload,
        )
      }
    }
    catch (error) {
      console.error('[EndgeRuntime] Failed to hydrate runtime filters', error)
    }
  }

  /**
   * Внутренний destroy для host с контролем уведомления подписчиков.
   */
  private destroyRuntimeInternal(
    runtimeId: string,
    shouldNotify: boolean,
  ): void {
    const id = String(runtimeId ?? '').trim()
    if (!id) {
      return
    }

    const host = this._hosts.removeById(id)
    if (!host) {
      return
    }

    if (Endge.debug.enabled) {
      const snapshot = host.snapshot()
      this._hosts.rememberDeletedSnapshot({
        ...snapshot,
        removedAt: Date.now(),
        status: 'destroyed',
        meta: {
          ...snapshot.meta,
          debugArchived: true,
          debugPreviousStatus: snapshot.status,
        },
      })
    }

    this._strategies.resolve(host.model)?.destroy?.({ host })
    Endge.context.destroyRuntimeStateController(id)
    host.destroy()
    if (shouldNotify) {
      this.notify()
    }
  }

  /**
   * Создаёт host через runtime strategy и регистрирует его в runtime-registry.
   */
  private createHost(
    strategy: AnyRuntimeStrategy,
    model: RuntimeExecutableModel,
    meta: Record<string, any>,
  ): AnyRuntimeHost | null {
    this.start()

    const parent = this.resolveParentHost(meta?.parent)
    const hostMeta = { ...(meta ?? {}) }
    delete hostMeta.parent
    const appScope = this.resolveAppScope(hostMeta.appScope, parent)
    delete hostMeta.appScope
    const artifactReader = isRuntimeArtifactReader(hostMeta.artifactReader)
      ? hostMeta.artifactReader
      : Endge.program
    delete hostMeta.artifactReader

    const scopeRoot = hostMeta.scopeRoot === true || !parent
    const identity = String((model as any)?.identity ?? (model as any)?.id ?? strategy.entityType)
    const address = appScope.allocate({
      entityType: strategy.entityType,
      identity,
      explicitRuntimeId: hostMeta.id,
      requestedLocalId: hostMeta.instanceId,
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
    hostMeta.runtimeLocalId = address.localId
    hostMeta.runtimePath = address.runtimePath
    hostMeta.scopeRoot = scopeRoot
    hostMeta.persistence ??= appScope.persistence

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

    if (!this.registerCreatedHost(host, parent)) {
      host.destroy()
      return null
    }

    strategy.attach?.({
      id: runtimeId,
      model,
      meta: hostMeta,
      parent,
      artifacts: artifactReader,
      host,
    })
    this.notify()
    return host
  }

  /** Регистрирует созданный host и связывает его Raph node с runtime tree. */
  private registerCreatedHost(host: AnyRuntimeHost, parent: AnyRuntimeHost | null): boolean {
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
    }
    catch (error) {
      console.error('[EndgeRuntime] Failed to register runtime host', error)
      return false
    }
    host.attachRuntimeState(Endge.context.createRuntimeStateController({
      runtimeId: host.id,
      storageId: typeof host.meta.persistenceKey === 'string' ? host.meta.persistenceKey : host.id,
      persistence: host.meta.persistence as any,
    }))
    return true
  }

  /**
   * Регистрирует встроенные стратегии в порядке от специальных к общим.
   */
  private registerDefaultStrategies(): void {
    this.registerStrategy(new CompositionRuntimeStrategy())
    this.registerStrategy(new StoreRuntimeStrategy())
    this.registerStrategy(new FilterRuntimeStrategy())
    this.registerStrategy(new QueryRuntimeStrategy())
    this.registerStrategy(new ComponentSFCRuntimeStrategy())
    this.registerStrategy(new ActionRuntimeStrategy())
    this.registerStrategy(new ProjectRuntimeStrategy())
    this.registerStrategy(new ViewRuntimeStrategy())
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

  /**
   * Разрешает Parent Host.
   */
  private resolveParentHost(rawParent: unknown): AnyRuntimeHost | null {
    if (!rawParent) {
      return null
    }

    if (typeof rawParent === 'string') {
      return this.getRuntimeById(rawParent)
    }

    if (
      typeof rawParent === 'object'
      && rawParent !== null
      && 'id' in rawParent
    ) {
      const id = String((rawParent as { id?: unknown }).id ?? '').trim()
      return id ? this.getRuntimeById(id) : null
    }

    return null
  }
}

function isRuntimeArtifactReader(value: unknown): value is import('@/domain/types/runtime/runtime-host.types').RuntimeArtifactReader {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as { getArtifact?: unknown }).getArtifact === 'function',
  )
}
