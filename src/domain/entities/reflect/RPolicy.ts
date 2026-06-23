import { Serialize } from '@endge/utils'
import { Expose } from 'class-transformer'

import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'
import { REntity } from '@/domain/entities/reflect/REntity'

/** Сущность политики (коллекция policies). identity, displayName, description, folder. */
export class RPolicy extends REntity {
  @Expose()
  description?: string | null = null

  toPlain(): Record<string, unknown> {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      description: this.description ?? null,
      folderId: this.folderId ?? null,
    }
  }

  override duplicate(options: DuplicateOptions): RPolicy {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return Serialize.fromJSON(RPolicy, plain)
  }
}
