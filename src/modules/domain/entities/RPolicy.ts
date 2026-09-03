import type { DuplicateOptions } from '@/modules/domain/entities/REntity'
import { Serialize } from '@endge/utils'

import { Expose } from 'class-transformer'
import { REntity } from '@/modules/domain/entities/REntity'

/** Сущность политики (коллекция policies). identity, displayName, description, folder. */
export class RPolicy extends REntity {
  @Expose()
  override description: string | null = null

  toPlain(): Record<string, unknown> {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      description: this.description ?? null,
      folderId: this.folderId ?? null,
      meta: { ...this.meta },
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
