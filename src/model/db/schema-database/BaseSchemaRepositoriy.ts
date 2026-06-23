import type {
  SchemaStorageAdapter,
  SchemaStorageQuery,
} from '@/model/db/schema-database/SchemaStorageAdapter'

export abstract class BaseSchemaRepository<TModel> {
  protected storage: SchemaStorageAdapter<TModel>

  constructor(adapter: SchemaStorageAdapter<TModel>) {
    this.storage = adapter
  }

  getById(id: string) {
    return this.storage.getById(id)
  }

  getByIdentity(identity: string) {
    return this.storage.getByIdentity(identity)
  }

  list(query?: SchemaStorageQuery) {
    return this.storage.list(query)
  }

  upsert(data: {
    identity: string
    displayName?: string
    folderId?: string | null
    author?: string
    active?: boolean
    model: TModel
  }) {
    return this.storage.upsert({
      displayName: data.displayName ?? data.identity,
      ...data,
    })
  }

  updateMeta(ids: string[], meta: any) {
    return this.storage.updateMeta(ids, meta)
  }

  softDelete(ids: string[]) {
    return this.storage.softDelete(ids)
  }

  setActive(ids: string[], active: boolean) {
    return this.storage.setActive(ids, active)
  }
}
