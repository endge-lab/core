import type { DuplicateOptions } from '@/features/core/modules/domain/entities/REntity'

import { Serialize } from '@endge/utils'
import { Exclude, Expose } from 'class-transformer'

import { REntity } from '@/features/core/modules/domain/entities/REntity'

/** Сохранённое source-first определение изменения, принадлежащее Store. */
export class RUpdate extends REntity {
  @Exclude()
  readonly type = 'update' as const

  /** Стабильный идентификатор единственного Store, который может выполнить этот Update. */
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
