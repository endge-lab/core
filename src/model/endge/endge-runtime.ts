import type { RComponent } from '@/domain/types/component.types'
import type { RuntimeEntityType } from '@/domain/types/runtime-entity-map.types'
import type { RuntimeHost } from '@/domain/types/runtime-host.types'
import type { RuntimeHostRegistrySnapshot } from '@/domain/types/runtime-registry.types'
import type { RuntimeKind } from '@/domain/types/runtime.types'

import { Raph } from '@endge/raph'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { RAction } from '@/domain/entities/reflect/RAction'
import { RComponentTable } from '@/domain/entities/reflect/RComponentTable'
import { RPage } from '@/domain/entities/reflect/RPage'
import { RProject } from '@/domain/entities/reflect/RProject'
import { RQuery } from '@/domain/entities/reflect/RQuery'
import { RView } from '@/domain/entities/reflect/RView'
import { ActionRuntimeHost } from '@/domain/entities/runtime/hosts/ActionRuntimeHost'
import { ComponentRuntimeHost } from '@/domain/entities/runtime/hosts/ComponentRuntimeHost'
import { PageRuntimeHost } from '@/domain/entities/runtime/hosts/PageRuntimeHost'
import { ProjectRuntimeHost } from '@/domain/entities/runtime/hosts/ProjectRuntimeHost'
import { QueryRuntimeHost } from '@/domain/entities/runtime/hosts/QueryRuntimeHost'
import { TableRuntimeHost } from '@/domain/entities/runtime/hosts/TableRuntimeHost'
import { ViewRuntimeHost } from '@/domain/entities/runtime/hosts/ViewRuntimeHost'
import { RuntimeHostRegistry } from '@/domain/entities/runtime/RuntimeHostRegistry'
import { Endge } from '@/model/endge/endge'
import { QueriesPhase } from '@/model/helpers/raph-phases/queries-phase'

export type RuntimeExecutableModel
  = | RQuery
    | RComponentTable
    | RAction
    | RProject
    | RView
    | RPage
    | RComponent

type RuntimeExecutionKind
  = | RuntimeKind
    | 'project'
    | 'view'
    | 'page'
    | 'component'
type AnyRuntimeHost = RuntimeHost<any, any>

export interface EndgeRuntimeSnapshot extends RuntimeHostRegistrySnapshot {
  generatedAt: number
}

export class EndgeRuntime extends EndgeModule {
  private _hosts = new RuntimeHostRegistry()
  private _nextRuntimeId = 0
  private _inited = false

  /**
   * Регистрирует runtime-фазы в Raph один раз.
   */
  public init(): void {
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
    const kind = this.detectKind(model)
    if (!kind) {
      console.error('[EndgeRuntime] Unsupported runtime model', model)
      return null
    }
    return this.createHost(kind, model, meta)
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
    if (!Endge.app.isDebug) {
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
    if (!Endge.app.isDebug) {
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
  public reset(): void {
    const hostIds = this._hosts.getAll().map(host => host.id)
    for (const runtimeId of hostIds) {
      this.destroyRuntimeInternal(runtimeId, false)
    }

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

    if (Endge.app.isDebug) {
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

    host.destroy()
    if (shouldNotify) {
      this.notify()
    }
  }

  /**
   * Определяет runtime-kind по переданной модели.
   */
  private detectKind(
    model: RuntimeExecutableModel,
  ): RuntimeExecutionKind | null {
    if (model instanceof RQuery || Array.isArray((model as any)?.filters)) {
      return 'query'
    }
    if (
      model instanceof RComponentTable
      || (model as any)?.type === 'component-table'
    ) {
      return 'table'
    }
    if (
      model instanceof RAction
      || Array.isArray((model as any)?.definition?.nodes)
    ) {
      return 'action'
    }
    if (model instanceof RProject || (model as any)?.type === 'project') {
      return 'project'
    }
    if (model instanceof RView || (model as any)?.type === 'view') {
      return 'view'
    }
    if (model instanceof RPage || (model as any)?.type === 'page') {
      return 'page'
    }
    if ((model as any)?.type?.startsWith?.('component-')) {
      return 'component'
    }
    return null
  }

  /**
   * Создаёт host конкретного kind и регистрирует его в runtime-registry.
   */
  private createHost(
    kind: RuntimeExecutionKind,
    model: RuntimeExecutableModel,
    meta: Record<string, any>,
  ): AnyRuntimeHost | null {
    const parent = this.resolveParentHost(meta?.parent)
    const hostMeta = { ...(meta ?? {}) }
    delete hostMeta.parent

    const runtimeId = this.createRuntimeId()
    let host: AnyRuntimeHost | null = null

    if (kind === 'query') {
      host = QueryRuntimeHost.createRuntime({
        id: runtimeId,
        model: model as RQuery,
        meta: hostMeta,
        parent,
      })
    }
    else if (kind === 'table') {
      host = TableRuntimeHost.createRuntime({
        id: runtimeId,
        model: model as RComponentTable,
        meta: hostMeta,
        parent,
      })
    }
    else if (kind === 'action') {
      host = ActionRuntimeHost.createRuntime({
        id: runtimeId,
        model: model as RAction,
        meta: hostMeta,
        parent,
      })
    }
    else if (kind === 'project') {
      host = ProjectRuntimeHost.createRuntime({
        id: runtimeId,
        model: model as RProject,
        meta: hostMeta,
        parent,
      })
    }
    else if (kind === 'view') {
      host = ViewRuntimeHost.createRuntime({
        id: runtimeId,
        model: model as RView,
        meta: hostMeta,
        parent,
      })
    }
    else if (kind === 'page') {
      host = PageRuntimeHost.createRuntime({
        id: runtimeId,
        model: model as RPage,
        meta: hostMeta,
        parent,
      })
    }
    else if (kind === 'component') {
      host = ComponentRuntimeHost.createRuntime({
        id: runtimeId,
        model: model as RComponent,
        meta: hostMeta,
        parent,
      })
    }

    if (!host) {
      return null
    }

    this._hosts.register(host)
    this.notify()
    return host
  }

  /**
   * Генерирует следующий runtime-id.
   */
  private createRuntimeId(): string {
    return `runtime-${this._nextRuntimeId++}`
  }

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
