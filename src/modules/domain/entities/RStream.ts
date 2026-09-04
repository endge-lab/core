import type { DuplicateOptions } from '@/modules/domain/entities/REntity'

import { Serialize } from '@endge/utils'
import { Exclude, Expose } from 'class-transformer'

import { REntity } from '@/modules/domain/entities/REntity'

/** Сохранённое source-first определение нормализованного потока событий. */
export class RStream extends REntity {
  @Exclude()
  readonly type = 'stream' as const

  @Expose()
  source: string = ''

  @Expose()
  sourceVersion: number = 1

  override duplicate(options: DuplicateOptions): RStream {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return Serialize.fromJSON(RStream, plain)
  }
}
