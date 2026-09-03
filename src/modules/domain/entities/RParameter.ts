import type { DomainDocumentType } from '@/modules/domain/types/document/document.types'
import type {
  FilterFieldSchema,
  RParameterSchema,
  RuntimeFilterLinkEntity,
} from '@/modules/domain/types/document/query.types'

import { TypeMap } from '@endge/utils'
import { Expose } from 'class-transformer'

import { REntity } from '@/modules/domain/entities/REntity'
import { ParameterType } from '@/modules/domain/types/document/document.types'

class RParameterField implements FilterFieldSchema {
  @Expose()
  key: string = ''

  @Expose()
  label: string = ''

  @Expose()
  description?: string

  @Expose()
  required?: boolean

  @Expose()
  multiple?: boolean

  @Expose()
  type: FilterFieldSchema['type'] = 'string'

  @Expose()
  staticValues?: FilterFieldSchema['staticValues']

  @Expose()
  dynamicSource?: FilterFieldSchema['dynamicSource']
}

export class RParameter extends REntity {
  @Expose()
  override description: string | null = null

  @Expose()
  @TypeMap(RParameterField, 'key')
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
    f.description = json.description ?? null
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
