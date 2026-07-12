import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'

import { Serialize } from '@endge/utils'
import { Expose } from 'class-transformer'

import { REntity } from '@/domain/entities/reflect/REntity'

/** Persisted source-first описание пользовательского хранилища. */
export class RStore extends REntity {
  @Expose()
  description: string | null = null

  @Expose()
  source: string = ''

  @Expose()
  sourceVersion: number = 1

  override duplicate(options: DuplicateOptions): RStore {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return Serialize.fromJSON(RStore, plain)
  }
}
