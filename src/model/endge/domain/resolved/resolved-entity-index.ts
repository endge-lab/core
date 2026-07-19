import type { REntity } from '@/domain/entities/reflect/REntity'

/** Generic index for non-persisted effective-domain descriptors. */
export class ResolvedEntityIndex {
  private readonly _entities = new Map<string, Map<string, REntity>>()

  public set<TEntity extends REntity>(type: string, entity: TEntity): void {
    const identity = String(entity.identity ?? '').trim()
    if (!identity)
      throw new Error(`Resolved ${type} identity is required.`)
    const byIdentity = this._entities.get(type) ?? new Map<string, REntity>()
    byIdentity.set(identity, entity)
    this._entities.set(type, byIdentity)
  }

  public get<TEntity extends REntity>(type: string, identity: string): TEntity | null {
    return (this._entities.get(type)?.get(identity) as TEntity | undefined) ?? null
  }

  public list<TEntity extends REntity>(type: string): TEntity[] {
    return [...(this._entities.get(type)?.values() ?? [])] as TEntity[]
  }

  public delete(type: string, identity: string): void {
    this._entities.get(type)?.delete(identity)
  }

  /** Clears only build-derived records while preserving builtin and local ones. */
  public clearDerived(type?: string): void {
    const entries = type ? [[type, this._entities.get(type)] as const] : [...this._entities.entries()]
    for (const [, byIdentity] of entries) {
      if (!byIdentity) continue
      for (const [identity, entity] of byIdentity) {
        if (entity.origin.kind === 'derived')
          byIdentity.delete(identity)
      }
    }
  }

  public clear(): void {
    this._entities.clear()
  }
}
