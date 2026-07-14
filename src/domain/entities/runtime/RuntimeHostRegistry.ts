import type { RuntimeEntityType } from '@/domain/types/runtime/runtime-entity-map.types'
import type { RuntimeHost, RuntimeHostSnapshot } from '@/domain/types/runtime/runtime-host.types'
import type {
  RuntimeHostRegistryLike,
  RuntimeHostRegistrySnapshot,
} from '@/domain/types/runtime/runtime-registry.types'

export class RuntimeHostRegistry implements RuntimeHostRegistryLike {
  private _hosts = new Map<string, RuntimeHost<any, any>>()
  private _indexByEntity = new Map<string, Set<string>>()
  private _childrenByParent = new Map<string, Set<string>>()
  private _deletedSnapshots = new Map<string, RuntimeHostSnapshot>()

  /**
   * ACCESS
   */
  public register<T extends RuntimeHost<any, any>>(host: T): T {
    const runtimeId = String(host.id ?? '').trim()
    if (!runtimeId) {
      throw new Error('[RuntimeHostRegistry] Runtime host id is required.')
    }
    if (this._hosts.has(runtimeId)) {
      throw new Error(`[RuntimeHostRegistry] Runtime host "${runtimeId}" is already registered.`)
    }

    const key = this.entityKey(host.entityType, host.entityIdentity)
    const set = this._indexByEntity.get(key) ?? new Set<string>()
    set.add(runtimeId)
    this._indexByEntity.set(key, set)
    this._hosts.set(runtimeId, host)
    const parentId = String(host.parent?.id ?? '').trim()
    if (parentId) {
      const children = this._childrenByParent.get(parentId) ?? new Set<string>()
      children.add(runtimeId)
      this._childrenByParent.set(parentId, children)
    }
    return host
  }

  /**
   * ACCESS
   */
  public getById(id: string): RuntimeHost<any, any> | null {
    const key = String(id ?? '').trim()
    if (!key)
      return null
    return this._hosts.get(key) ?? null
  }

  /**
   * ACCESS
   */
  public getAll(): RuntimeHost<any, any>[] {
    return Array.from(this._hosts.values())
  }

  /** Возвращает runtime subtree в безопасном для destroy порядке: children first. */
  public getTreePostOrder(rootId: string): string[] {
    const ordered: string[] = []
    const visited = new Set<string>()
    const visit = (id: string) => {
      if (!id || visited.has(id))
        return
      visited.add(id)
      for (const childId of this._childrenByParent.get(id) ?? [])
        visit(childId)
      ordered.push(id)
    }
    visit(String(rootId ?? '').trim())
    return ordered
  }

  /**
   * ACCESS
   */
  public getByEntity(entityType: RuntimeEntityType, entityIdentity: string): RuntimeHost<any, any>[] {
    const key = this.entityKey(entityType, entityIdentity)
    const ids = this._indexByEntity.get(key)
    if (!ids?.size)
      return []

    const out: RuntimeHost<any, any>[] = []
    for (const id of ids) {
      const host = this._hosts.get(id)
      if (host)
        out.push(host)
    }
    return out
  }

  /**
   * ACCESS
   */
  public removeById(id: string): RuntimeHost<any, any> | null {
    const key = String(id ?? '').trim()
    if (!key)
      return null

    const host = this._hosts.get(key) ?? null
    if (!host)
      return null

    const entityKey = this.entityKey(host.entityType, host.entityIdentity)
    const set = this._indexByEntity.get(entityKey)
    set?.delete(key)
    if (set && set.size === 0)
      this._indexByEntity.delete(entityKey)

    this._hosts.delete(key)
    const parentId = String(host.parent?.id ?? '').trim()
    const siblings = parentId ? this._childrenByParent.get(parentId) : null
    siblings?.delete(key)
    if (parentId && siblings?.size === 0)
      this._childrenByParent.delete(parentId)
    this._childrenByParent.delete(key)
    return host
  }

  /**
   * LIFECYCLE
   */
  public clear(): void {
    for (const host of this._hosts.values())
      host.destroy()
    this._hosts.clear()
    this._indexByEntity.clear()
    this._childrenByParent.clear()
  }

  /**
   * ACCESS
   */
  public rememberDeletedSnapshot(snapshot: RuntimeHostSnapshot): void {
    const key = String(snapshot.id ?? '').trim()
    if (!key)
      return

    this._deletedSnapshots.set(key, snapshot)
  }

  /**
   * ACCESS
   */
  public getDeletedSnapshots(): RuntimeHostSnapshot[] {
    return Array.from(this._deletedSnapshots.values())
  }

  /**
   * ACCESS
   */
  public removeDeletedSnapshot(id: string): RuntimeHostSnapshot | null {
    const key = String(id ?? '').trim()
    if (!key)
      return null

    const snapshot = this._deletedSnapshots.get(key) ?? null
    if (!snapshot)
      return null

    this._deletedSnapshots.delete(key)
    return snapshot
  }

  /**
   * ACCESS
   */
  public clearDeleted(): void {
    this._deletedSnapshots.clear()
  }

  /**
   * ACCESS
   */
  public snapshot(): RuntimeHostRegistrySnapshot {
    const hosts = this.getAll().map(host => host.snapshot())
    const deletedHosts = this.getDeletedSnapshots()
    const byStatus: Record<string, number> = {}
    for (const host of hosts)
      byStatus[host.status] = (byStatus[host.status] ?? 0) + 1

    return {
      total: hosts.length,
      byStatus,
      hosts,
      deletedTotal: deletedHosts.length,
      deletedHosts,
    }
  }

  /**
   * ACCESS
   */
  private entityKey(entityType: RuntimeEntityType, entityIdentity: string): string {
    return `${entityType}:${String(entityIdentity ?? '').trim()}`
  }
}
