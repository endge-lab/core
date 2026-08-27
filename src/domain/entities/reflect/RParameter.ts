import type { DomainDocumentType } from '@/domain/types/document/document.types'
import type {
  FilterFieldSchema,
  RParameterSchema,
  RuntimeFilterLinkEntity,
} from '@/domain/types/document/query.types'

import { TypeMap } from '@endge/utils'
import { Expose } from 'class-transformer'

import { REntity } from '@/domain/entities/reflect/REntity'
import { ParameterType } from '@/domain/types/document/document.types'

export class RParameter extends REntity {
  @Expose()
  displayName!: string

  @Expose()
  description?: string

  @Expose()
  @TypeMap(null, 'key')
  fields: Map<string, FilterFieldSchema> = new Map()

  @Expose()
  runtimeFilters: RuntimeFilterLinkEntity[] = []

  get type(): DomainDocumentType {
    return ParameterType.DefaultParameter
  }

  static fromPlain(json: RParameterSchema): RParameter {
    const f = new RParameter()
    f.id = (json as any).id ?? json.identity
    f.identity = json.identity
    f.name = json.displayName
    f.displayName = json.displayName
    f.description = json.description ?? undefined
    f.folderId = json.folderId ?? json.folder ?? null
    f.active = json.active ?? true
    f.deletedAt = json.deletedAt ?? null
    f.runtimeFilters = (json as any).runtimeFilters ?? []
    f.applyEntityMeta(json)

    f.fields = new Map()
    if (Array.isArray(json.fields)) {
      for (const fld of json.fields) {
        f.fields.set(fld.key, { ...fld })
      }
    }

    return f
  }

  toPlain(): RParameterSchema {
    return {
      identity: this.identity,
      displayName: this.displayName,
      description: this.description,
      folderId: this.folderId,
      author: this.author ?? undefined,
      active: this.active ?? true,
      deletedAt: this.deletedAt ?? null,
      fields: [...this.fields.values()].map(x => ({ ...x })),
      runtimeFilters: (this.runtimeFilters ?? []).map(x => ({ ...x })),
      meta: { ...this.meta },
    }
  }
}
