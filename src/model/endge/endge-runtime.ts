import type { RuntimeEntityType } from '@/domain/types/runtime-entity-map.types'
import type { AnyRuntimeStrategy, EndgeRuntimeSnapshot, RuntimeExecutableModel } from '@/domain/types/runtime.types'

import { Raph, RaphNode } from '@endge/raph'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { RuntimeHostRegistry } from '@/domain/entities/runtime/RuntimeHostRegistry'
import type { AnyRuntimeHost } from '@/domain/services/runtime/RuntimeStrategy'
import { RuntimeStrategyRegistry } from '@/domain/services/runtime/RuntimeStrategyRegistry'
import { ActionRuntimeStrategy } from '@/domain/services/runtime/strategies/ActionRuntimeStrategy'
import { ComponentRuntimeStrategy } from '@/domain/services/runtime/strategies/ComponentRuntimeStrategy'
import { ComponentSFCRuntimeStrategy } from '@/domain/services/runtime/strategies/ComponentSFCRuntimeStrategy'
import { PageRuntimeStrategy } from '@/domain/services/runtime/strategies/PageRuntimeStrategy'
import { ProjectRuntimeStrategy } from '@/domain/services/runtime/strategies/ProjectRuntimeStrategy'
import { QueryRuntimeStrategy } from '@/domain/services/runtime/strategies/QueryRuntimeStrategy'
import { TableRuntimeStrategy } from '@/domain/services/runtime/strategies/TableRuntimeStrategy'
import { ViewRuntimeStrategy } from '@/domain/services/runtime/strategies/ViewRuntimeStrategy'
import { FilterRuntimeStrategy } from '@/domain/services/runtime/strategies/FilterRuntimeStrategy'
import { CompositionRuntimeStrategy } from '@/domain/services/runtime/strategies/CompositionRuntimeStrategy'
import { Endge } from '@/model/endge/endge'
import { RuntimeBoundaryUpdatePhase } from '@/model/helpers/raph-phases/runtime-boundary-update-phase'
import { RuntimeNodeUpdatePhase } from '@/model/helpers/raph-phases/runtime-node-update-phase'

export class EndgeRuntime extends EndgeModule {
  private _hosts = new RuntimeHostRegistry()
  private _strategies = new RuntimeStrategyRegistry()
  private _nextRuntimeId = 0
  private _inited = false
  private _appNode: RaphNode | null = null

  public constructor() {
    super()
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
  ): AnyRuntimeHost[] {
    return this._hosts.getByEntity(entityType, entityIdentity)
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
    this._appNode = null
    this._inited = false

    // Единый notify после batch-reset.
    this.notify()
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

    const runtimeId = this.resolveRuntimeId(hostMeta.id)
    if (this._hosts.getById(runtimeId)) {
      console.error(`[EndgeRuntime] Runtime host "${runtimeId}" is already active.`)
      return null
    }

    const host = strategy.create({
      id: runtimeId,
      model,
      meta: hostMeta,
      parent,
      artifacts: Endge.program,
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
      artifacts: Endge.program,
      host,
    })
    this.notify()
    return host
  }

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
      ;(parent?.node ?? this._appNode)?.addChild(host.node, { invalidate: false })
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
    this.registerStrategy(new FilterRuntimeStrategy())
    this.registerStrategy(new QueryRuntimeStrategy())
    this.registerStrategy(new TableRuntimeStrategy())
    this.registerStrategy(new ComponentSFCRuntimeStrategy())
    this.registerStrategy(new ActionRuntimeStrategy())
    this.registerStrategy(new ProjectRuntimeStrategy())
    this.registerStrategy(new ViewRuntimeStrategy())
    this.registerStrategy(new PageRuntimeStrategy())
    this.registerStrategy(new ComponentRuntimeStrategy())
  }

  /**
   * Генерирует следующий runtime-id.
   */
  private createRuntimeId(): string {
    return `runtime-${this._nextRuntimeId++}`
  }

  private resolveRuntimeId(value: unknown): string {
    const explicit = String(value ?? '').trim()
    return explicit || this.createRuntimeId()
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
