import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'

import { Serialize } from '@endge/utils'
import { Expose } from 'class-transformer'

import { REntity } from '@/domain/entities/reflect/REntity'

/** Source-first описание переиспользуемого преобразования данных. */
export class RDataView extends REntity {
  /** Авторский source DataView. Является persisted source of truth. */
  @Expose()
  source: string = ''

  /** Версия синтаксиса source для миграций и diagnostics. */
  @Expose()
  sourceVersion: number = 1

  /** Создает копию DataView без привязки к старой папке. */
  override duplicate(options: DuplicateOptions): RDataView {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return Serialize.fromJSON(RDataView, plain)
  }
}
