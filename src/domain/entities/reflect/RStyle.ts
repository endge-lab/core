import { Serialize } from '@endge/utils'
import { Expose } from 'class-transformer'

import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'
import { REntity } from '@/domain/entities/reflect/REntity'

/** Сущность стиля (коллекция styles). identity, displayName, folder, project, styles, meta, inherited, isSystem. */
export class RStyle extends REntity {
  @Expose()
  styles: Record<string, unknown> = {}

  toPlain(): Record<string, unknown> {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      folderId: this.folderId ?? null,
      project: this.project ?? null,
      styles: this.styles && typeof this.styles === 'object' ? this.styles : {},
      meta: this.meta ?? {},
      inherited: this.inherited,
      isSystem: this.isSystem,
    }
  }

  override duplicate(options: DuplicateOptions): RStyle {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return Serialize.fromJSON(RStyle, plain)
  }
}
