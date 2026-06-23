import type { FilterFieldItemSchema, RFilterSchema } from '@/domain/types/filter.types'
import type { DomainDocumentType } from '@/domain/types/document.types'

import { Expose } from 'class-transformer'

import { REntity } from '@/domain/entities/reflect/REntity'
import { FilterType } from '@/domain/types/document.types'

export class RFilter extends REntity {
  @Expose()
  displayName!: string

  @Expose()
  fields: FilterFieldItemSchema[] = []

  get type(): DomainDocumentType {
    return FilterType.DefaultFilter
  }

  static fromPayload(raw: any): RFilter {
    const f = new RFilter()
    f.id = raw.id
    f.identity = raw.identity ?? ''
    let displayName = raw.displayName ?? raw.identity
    // В Payload сохраняем с суффиксом (identity) для уникальности; в домене показываем короткое имя
    if (raw.inherited === true && typeof displayName === 'string' && typeof f.identity === 'string') {
      const suffix = ` (${f.identity})`
      if (displayName.endsWith(suffix))
        displayName = displayName.slice(0, -suffix.length)
    }
    f.name = displayName
    f.displayName = displayName
    const folderId = raw.folder != null && typeof raw.folder === 'object' ? raw.folder.id : (typeof raw.folder === 'number' || typeof raw.folder === 'string' ? raw.folder : null)
    f.folderId = folderId ?? null
    f.active = raw.active ?? true
    f.inherited = raw.inherited === true
    f.fields = Array.isArray(raw.fields) ? raw.fields.map((x: any) => ({ ...x, multiple: x.multiple !== false })) : []
    f.applyStorageMeta(raw)
    return f
  }

  static fromPlain(json: RFilterSchema): RFilter {
    const f = new RFilter()
    f.id = (json as any).id ?? json.identity
    f.identity = json.identity
    f.name = json.displayName
    f.displayName = json.displayName
    f.folderId = json.folderId ?? json.folder ?? null
    f.active = json.active ?? true
    f.inherited = json.inherited === true
    f.deletedAt = json.deletedAt ?? null
    f.fields = Array.isArray(json.fields) ? json.fields.map(x => ({ ...x, multiple: x.multiple !== false })) : []
    f.meta = (json.meta && typeof json.meta === 'object' && !Array.isArray(json.meta)) ? { ...json.meta } : {}
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
      meta: this.meta && Object.keys(this.meta).length > 0 ? { ...this.meta } : undefined,
      inherited: this.inherited ?? false,
    }
  }
}
