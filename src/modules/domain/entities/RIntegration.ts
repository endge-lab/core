import type { DuplicateOptions } from '@/modules/domain/entities/REntity'
import type { EntityManagement } from '@/modules/domain/types/document/entity-management.type'

import { Serialize } from '@endge/utils'
import { Expose } from 'class-transformer'
import { REntity } from '@/modules/domain/entities/REntity'

export interface RIntegrationSchema extends EntityManagement {
  id: string | number
  identity: string
  name: string
  description?: string | null
  meta: Record<string, unknown>
}

/** Сущность интеграции (коллекция integrations). */
export class RIntegration extends REntity {
  @Expose()
  description: string | null = null

  toPlain(): RIntegrationSchema {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      description: this.description ?? null,
      managedBy: this.managedBy,
      managedById: this.managedById,
      meta: { ...this.meta },
    }
  }

  override duplicate(options: DuplicateOptions): RIntegration {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    return Serialize.fromJSON(RIntegration, plain)
  }
}
