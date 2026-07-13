import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'

import { Serialize } from '@endge/utils'
import { Exclude, Expose } from 'class-transformer'

import { REntity } from '@/domain/entities/reflect/REntity'

/** Persisted source-first описание runtime-графа без layout/rendering. */
export class RComposition extends REntity {
  @Exclude()
  readonly type = 'composition' as const

  @Expose()
  description: string | null = null

  @Expose()
  source: string = ''

  @Expose()
  sourceVersion: number = 1

  override duplicate(options: DuplicateOptions): RComposition {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return Serialize.fromJSON(RComposition, plain)
  }
}
