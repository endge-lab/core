export interface SchemaStorageItemMeta {
  id: string
  identity: string
  displayName: string
  folderId: string | null
  author?: string
  active: boolean
  deletedAt: string | null
}

export interface SchemaStorageItem<TModel> extends SchemaStorageItemMeta {
  model: TModel
}

export interface SchemaStorageQuery {
  identity?: string
  activeOnly?: boolean
  includeDeleted?: boolean
  limit?: number
  page?: number
}

export interface SchemaStorageAdapter<TModel> {
  getById(id: string): Promise<SchemaStorageItem<TModel> | null>
  getByIdentity(identity: string): Promise<SchemaStorageItem<TModel> | null>
  list(query?: SchemaStorageQuery): Promise<SchemaStorageItem<TModel>[]>

  upsert(data: {
    identity: string
    displayName: string
    folderId?: string | null
    author?: string
    active?: boolean
    model: TModel
  }): Promise<SchemaStorageItem<TModel>>

  updateMeta(
    ids: string[],
    meta: Partial<{
      displayName: string
      identity: string
      folderId: string | null
      author?: string
    }>,
  ): Promise<void>

  softDelete(ids: string[]): Promise<void>
  setActive(ids: string[], active: boolean): Promise<void>
}
