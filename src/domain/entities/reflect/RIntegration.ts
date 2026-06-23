import { Serialize } from '@endge/utils'
import { Expose } from 'class-transformer'

import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'
import { REntity } from '@/domain/entities/reflect/REntity'

export interface RIntegrationSchema {
  id: string
  name: string
  description?: string | null
  isSystem?: boolean
}

/** Сущность интеграции (коллекция integrations). */
export class RIntegration extends REntity {
  @Expose()
  description: string | null = null

  toPlain(): RIntegrationSchema {
    return {
      id: this.id,
      name: this.name,
      description: this.description ?? null,
      isSystem: this.isSystem,
    }
  }

  override duplicate(options: DuplicateOptions): RIntegration {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return Serialize.fromJSON(RIntegration, plain)
  }
}
