import { Serialize } from '@endge/utils'
import { Expose } from 'class-transformer'

import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'
import { REntity } from '@/domain/entities/reflect/REntity'

/** Сущность окружения (коллекция environments). Без привязки к проекту. */
export class REnvironment extends REntity {
  toPlain(): Record<string, unknown> {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      folderId: this.folderId ?? null,
      isSystem: this.isSystem,
    }
  }

  override duplicate(options: DuplicateOptions): REnvironment {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return Serialize.fromJSON(REnvironment, plain)
  }
}
