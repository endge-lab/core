import type { RuntimeEntityType } from '@/domain/types/runtime-entity-map.types'
import type { AnyRuntimeStrategy, EndgeRuntimeSnapshot, RuntimeExecutableModel } from '@/domain/types/runtime.types'

import { Raph } from '@endge/raph'

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
import { Endge } from '@/model/endge/endge'
import { QueriesPhase } from '@/model/helpers/raph-phases/queries-phase'

export class EndgeRuntime extends EndgeModule {
  private _hosts = new RuntimeHostRegistry()
  private _strategies = new RuntimeStrategyRegistry()
  private _nextRuntimeId = 0
  private _inited = false

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

    Raph.addPhase(QueriesPhase.make())
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

    const hosts = this._hosts.getAll()
    if (!hosts.some(host => host.id === rootId)) {
      return
    }

    const childrenByParentId = new Map<string, string[]>()
    for (const host of hosts) {
      const parentId = String(host.parent?.id ?? '').trim()
      if (!parentId) {
        continue
      }
      childrenByParentId.set(parentId, [
        ...(childrenByParentId.get(parentId) ?? []),
        host.id,
      ])
    }

    const orderedIds: string[] = []
    const visited = new Set<string>()
    const visit = (id: string) => {
      if (!id || visited.has(id)) {
        return
      }
      visited.add(id)
      for (const childId of childrenByParentId.get(id) ?? []) {
        visit(childId)
      }
      orderedIds.push(id)
    }

    visit(rootId)

    for (const id of orderedIds) {
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
    const parent = this.resolveParentHost(meta?.parent)
    const hostMeta = { ...(meta ?? {}) }
    delete hostMeta.parent

    const runtimeId = this.createRuntimeId()
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

    this._hosts.register(host)
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

  /**
   * Регистрирует встроенные стратегии в порядке от специальных к общим.
   */
  private registerDefaultStrategies(): void {
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
