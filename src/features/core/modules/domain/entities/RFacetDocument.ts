import type { EndgeConfigurationContribution } from '@/features/core/modules/configuration/domain/types/configuration.type'

import type { EndgeDocumentServerState } from '@/features/core/modules/domain/types/document/domain-snapshot.type'
import { Expose } from 'class-transformer'

import { normalizeEndgeConfigurationContribution } from '@/features/core/modules/configuration/domain/endge-configuration'
import { normalizeEntityMeta, REntity } from '@/features/core/modules/domain/entities/REntity'

/** Persisted contribution document whose identity is scoped by facetIdentity. */
export class RFacetDocument extends REntity<string | number> {
  /** Optimistic-lock and audit state returned only by a live persistence provider. */
  serverState: EndgeDocumentServerState | null = null

  @Expose()
  facetIdentity = ''

  @Expose()
  configuration: EndgeConfigurationContribution = { mode: 'inherit', patch: {} }

  public static fromPlain(input: Record<string, unknown>): RFacetDocument {
    const document = new RFacetDocument()
    document.id = (input.id ?? `${String(input.facetIdentity ?? '')}:${String(input.identity ?? '')}`) as string | number
    document.facetIdentity = String(input.facetIdentity ?? '').trim()
    document.identity = String(input.identity ?? '').trim()
    document.displayName = String(input.displayName ?? input.name ?? document.identity)
    document.name = document.displayName
    document.description = typeof input.description === 'string' && input.description.trim()
      ? input.description.trim()
      : null
    document.configuration = normalizeEndgeConfigurationContribution(input.configuration)
    document.serverState = input.serverState != null && typeof input.serverState === 'object'
      ? { ...(input.serverState as EndgeDocumentServerState) }
      : null
    document.active = typeof input.active === 'boolean' ? input.active : true
    document.meta = normalizeEntityMeta(input.meta)
    document.createdAt = typeof input.createdAt === 'string' ? input.createdAt : undefined
    document.updatedAt = typeof input.updatedAt === 'string' ? input.updatedAt : undefined
    document.deletedAt = typeof input.deletedAt === 'string' ? input.deletedAt : null
    return document
  }

  public toPlain(): Record<string, unknown> {
    return {
      id: this.id,
      facetIdentity: this.facetIdentity,
      identity: this.identity,
      displayName: this.displayName,
      description: this.description,
      configuration: this.configuration,
      meta: { ...this.meta },
      active: this.active ?? true,
    }
  }
}
