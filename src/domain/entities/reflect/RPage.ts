import { Serialize } from '@endge/utils'
import { Expose } from 'class-transformer'

import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'
import { REntity } from '@/domain/entities/reflect/REntity'
import type { DomainDocumentType } from '@/domain/types/document/document.types'
import type { EntityManagement } from '@/domain/types/document'

export interface RPageAreaBlockSchema {
  key: string
  entityType?: string | null
  /** Целочисленный id документа в Payload (relation value). */
  entityId?: number | null
  /** Identity сущности (для отображения и fallback при сохранении). */
  entityIdentity?: string | null
  titleOverride?: string | null
  visibleWhen?: string | null
  props?: Record<string, unknown> | null
}

export interface RPageAreaSchema {
  slotId: string
  blocks?: RPageAreaBlockSchema[]
}

export interface RPageSchema extends EntityManagement {
  id: number
  identity: string
  name: string
  description?: string | null
  routeName?: string | null
  routePath?: string | null
  templateId?: number | null
  enabled?: boolean
  areas?: RPageAreaSchema[]
  meta?: Record<string, unknown>
}

/** Страница приложения (коллекция pages). */
export class RPage extends REntity {
  @Expose()
  description: string | null = null

  @Expose()
  routeName: string | null = null

  @Expose()
  routePath: string | null = null

  @Expose()
  templateId: number | null = null

  @Expose()
  enabled: boolean = true

  @Expose()
  areas: RPageAreaSchema[] = []

  /** Тип документа для редактора/инспектора. */
  get type(): DomainDocumentType {
    return 'page' as DomainDocumentType
  }

  toPlain(): RPageSchema {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      description: this.description ?? null,
      managedBy: this.managedBy,
      managedById: this.managedById,
      routeName: this.routeName ?? null,
      routePath: this.routePath ?? null,
      templateId: this.templateId ?? null,
      enabled: this.enabled,
      areas: this.areas?.length ? this.areas.map(a => ({
        slotId: a.slotId,
        blocks: a.blocks?.map(b => ({ ...b })),
      })) : undefined,
      meta: this.meta && Object.keys(this.meta).length > 0 ? { ...this.meta } : undefined,
    }
  }

  override duplicate(options: DuplicateOptions): RPage {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return Serialize.fromJSON(RPage, plain)
  }
}
