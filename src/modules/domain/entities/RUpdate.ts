import type { DuplicateOptions } from '@/modules/domain/entities/REntity'

import { Serialize } from '@endge/utils'
import { Exclude, Expose } from 'class-transformer'

import { REntity } from '@/modules/domain/entities/REntity'

/** Persisted source-first Store-owned mutation definition. */
export class RUpdate extends REntity {
  @Exclude()
  readonly type = 'update' as const

  /** Stable identity of the only Store that may execute this Update. */
  @Expose()
  storeIdentity: string = ''

  @Expose()
  source: string = ''

  @Expose()
  sourceVersion: number = 1

  override duplicate(options: DuplicateOptions): RUpdate {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    return Serialize.fromJSON(RUpdate, plain)
  }
}
