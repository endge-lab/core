import { Serialize } from '@endge/utils'
import { Expose } from 'class-transformer'

import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'
import { REntity } from '@/domain/entities/reflect/REntity'

export interface RViewSchema {
  id: number
  identity: string
  name: string
  description?: string | null
  isSystem?: boolean
  componentId?: number | null
  filterId?: number | null
  queryId?: number | null
  meta?: Record<string, unknown>
}

/** Сущность вида (коллекция views). */
export class RView extends REntity {
  @Expose()
  description: string | null = null

  @Expose()
  componentId: number | null = null

  @Expose()
  filterId: number | null = null

  @Expose()
  queryId: number | null = null

  toPlain(): RViewSchema {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      description: this.description ?? null,
      isSystem: this.isSystem,
      componentId: this.componentId ?? null,
      filterId: this.filterId ?? null,
      queryId: this.queryId ?? null,
      meta: this.meta && Object.keys(this.meta).length > 0 ? { ...this.meta } : undefined,
    }
  }

  override duplicate(options: DuplicateOptions): RView {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return Serialize.fromJSON(RView, plain)
  }
}
