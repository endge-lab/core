import type { EndgeDocumentServerState } from '@/features/core/modules/domain/types/document/domain-snapshot.type'
import { Expose } from 'class-transformer'

import { normalizeEntityMeta, REntity } from '@/features/core/modules/domain/entities/REntity'

/** Persisted authoring definition of a dynamic configuration facet. */
export class RFacet extends REntity<string | number> {
  /** Optimistic-lock and audit state returned only by a live persistence provider. */
  serverState: EndgeDocumentServerState | null = null

  @Expose()
  icon = 'Layers'

  @Expose()
  color = '#2563eb'

  @Expose()
  position = 0

  /** Server-computed number of active documents in this facet. */
  @Expose()
  documentCount = 0

  public static fromPlain(input: Record<string, unknown>): RFacet {
    const facet = new RFacet()
    facet.id = (input.id ?? input.identity ?? '') as string | number
    facet.identity = String(input.identity ?? '').trim()
    facet.displayName = String(input.displayName ?? input.name ?? facet.identity)
    facet.name = facet.displayName
    facet.icon = String(input.icon ?? 'Layers').trim() || 'Layers'
    facet.color = String(input.color ?? '#2563eb').trim().toLowerCase()
    facet.position = Number(input.position ?? 0)
    facet.documentCount = Number(input.documentCount ?? 0)
    facet.serverState = input.serverState != null && typeof input.serverState === 'object'
      ? { ...(input.serverState as EndgeDocumentServerState) }
      : null
    facet.active = typeof input.active === 'boolean' ? input.active : true
    facet.meta = normalizeEntityMeta(input.meta)
    facet.createdAt = typeof input.createdAt === 'string' ? input.createdAt : undefined
    facet.updatedAt = typeof input.updatedAt === 'string' ? input.updatedAt : undefined
    facet.deletedAt = typeof input.deletedAt === 'string' ? input.deletedAt : null
    return facet
  }

  public toPlain(): Record<string, unknown> {
    return {
      id: this.id,
      identity: this.identity,
      displayName: this.displayName,
      icon: this.icon,
      color: this.color,
      position: this.position,
      documentCount: this.documentCount,
      meta: { ...this.meta },
      active: this.active ?? true,
    }
  }
}
