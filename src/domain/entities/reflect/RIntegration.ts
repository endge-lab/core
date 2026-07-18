import { Serialize } from '@endge/utils'
import { Expose } from 'class-transformer'

import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'
import { REntity } from '@/domain/entities/reflect/REntity'
import type { EntityManagement } from '@/domain/types/document'

export interface RIntegrationSchema extends EntityManagement {
  id: string | number
  identity: string
  name: string
  description?: string | null
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
