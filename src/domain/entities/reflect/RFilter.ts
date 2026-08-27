import type { DomainDocumentType } from '@/domain/types/document/document.types'
import type { FilterFieldItemSchema, RFilterSchema } from '@/domain/types/document/filter.types'

import { Expose } from 'class-transformer'

import { REntity } from '@/domain/entities/reflect/REntity'
import { FilterType } from '@/domain/types/document/document.types'

export class RFilter extends REntity {
  @Expose()
  displayName!: string

  @Expose()
  fields: FilterFieldItemSchema[] = []

  /** Независимый source-first контракт нового Filter runtime. */
  @Expose()
  source: string = ''

  /** Версия Filter source syntax. */
  @Expose()
  sourceVersion: number = 1

  get type(): DomainDocumentType {
    return FilterType.DefaultFilter
  }

  static fromPlain(json: RFilterSchema): RFilter {
    const f = new RFilter()
    f.id = (json as any).id ?? json.identity
    f.identity = json.identity
    f.name = json.displayName
    f.displayName = json.displayName
    f.folderId = json.folderId ?? json.folder ?? null
    f.active = json.active ?? true
    f.deletedAt = json.deletedAt ?? null
    f.fields = Array.isArray(json.fields) ? json.fields.map(x => ({ ...x, multiple: x.multiple !== false })) : []
    f.source = String(json.source ?? '')
    f.sourceVersion = Number(json.sourceVersion ?? 1) || 1
    f.applyEntityMeta(json)
    return f
  }

  toPlain(): RFilterSchema {
    return {
      identity: this.identity,
      displayName: this.displayName,
      folderId: this.folderId,
      author: this.author ?? undefined,
      active: this.active ?? true,
      deletedAt: this.deletedAt ?? null,
      fields: this.fields.map(x => ({ ...x })),
      source: this.source,
      sourceVersion: this.sourceVersion,
      meta: this.meta && Object.keys(this.meta).length > 0 ? { ...this.meta } : undefined,
    }
  }
}
