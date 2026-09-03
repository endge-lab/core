import type { DuplicateOptions } from '@/modules/domain/entities/REntity'
import type { DomainDocumentType } from '@/modules/domain/types/document/document.types'

import type { EntityManagement } from '@/modules/domain/types/document/entity-management.type'
import { Serialize } from '@endge/utils'
import { Expose } from 'class-transformer'
import { REntity } from '@/modules/domain/entities/REntity'

export interface RPageTemplateAreaSchema {
  identity: string
  title?: string | null
  description?: string | null
}

/** short | normal | tall - высота строки в превью. */
export type RPageTemplatePreviewRowHeight = 'short' | 'normal' | 'tall'

export interface RPageTemplatePreviewSchema {
  rows: string[][]
  rowHeights?: RPageTemplatePreviewRowHeight[]
}

export interface RPageTemplateSchema extends EntityManagement {
  id: string | number
  name: string
  description?: string | null
  areas?: RPageTemplateAreaSchema[]
  preview?: RPageTemplatePreviewSchema | null
  meta?: Record<string, unknown>
}

/** Шаблон страницы (коллекция page-templates). */
export class RPageTemplate extends REntity {
  @Expose()
  description: string | null = null

  @Expose()
  areas: RPageTemplateAreaSchema[] = []

  @Expose()
  preview: RPageTemplatePreviewSchema | null = null

  /** Тип документа для редактора/инспектора. */
  get type(): DomainDocumentType {
    return 'page-template' as DomainDocumentType
  }

  toPlain(): RPageTemplateSchema {
    return {
      id: this.id,
      name: this.name,
      description: this.description ?? null,
      managedBy: this.managedBy,
      managedById: this.managedById,
      areas: this.areas?.length ? this.areas.map(a => ({ ...a })) : undefined,
      preview: this.preview ?? undefined,
      meta: this.meta && Object.keys(this.meta).length > 0 ? { ...this.meta } : undefined,
    }
  }

  override duplicate(options: DuplicateOptions): RPageTemplate {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return Serialize.fromJSON(RPageTemplate, plain)
  }
}
