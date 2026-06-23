import type { PayloadHttpClient } from '@endge/utils'
import type {
  SchemaStorageAdapter,
  SchemaStorageItem,
  SchemaStorageQuery,
} from '@/model/db/schema-database/SchemaStorageAdapter'

export class PayloadSchemaAdapter<TModel, TSchema>
  implements SchemaStorageAdapter<TModel>
{
  private http: PayloadHttpClient
  private collection: string
  private fromSchema: (schema: TSchema) => TModel
  private toSchema: (model: TModel) => TSchema

  constructor(params: {
    http: PayloadHttpClient
    collection: string
    fromSchema: (schema: TSchema) => TModel
    toSchema: (model: TModel) => TSchema
  }) {
    this.http = params.http
    this.collection = params.collection
    this.fromSchema = params.fromSchema
    this.toSchema = params.toSchema
  }

  private map(doc: any): SchemaStorageItem<TModel> {
    return {
      id: doc.id,
      identity: doc.identity,
      displayName: doc.displayName,
      folderId:
        typeof doc.folder === 'string' ? doc.folder : (doc.folder?.id ?? null),
      author: doc.author,
      active: doc.active,
      deletedAt: doc.deletedAt ?? null,
      model: this.fromSchema(doc.schema),
    }
  }

  async getById(id: string): Promise<SchemaStorageItem<TModel> | null> {
    const doc = await this.http
      .get(`/api/${this.collection}/${id}`)
      .catch(() => null)
    if (!doc) return null
    return this.map(doc)
  }

  async getByIdentity(
    identity: string,
  ): Promise<SchemaStorageItem<TModel> | null> {
    const res = await this.http.get(`/api/${this.collection}`, {
      'where[identity][equals]': identity,
      limit: 1,
    })
    const doc = res?.docs?.[0]
    if (!doc) return null
    return this.map(doc)
  }

  async list(query?: SchemaStorageQuery): Promise<SchemaStorageItem<TModel>[]> {
    const q: any = { limit: query?.limit ?? 500 }

    if (query?.identity) q['where[identity][equals]'] = query.identity

    if (query?.activeOnly) q['where[active][equals]'] = true

    if (!query?.includeDeleted) q['where[deletedAt][exists]'] = false

    const res = await this.http.get(`/api/${this.collection}`, q)
    return res.docs.map((d: any) => this.map(d))
  }

  async upsert(data: {
    identity: string
    displayName: string
    folderId?: string | null
    author?: string
    active?: boolean
    model: TModel
  }): Promise<SchemaStorageItem<TModel>> {
    const existing = await this.getByIdentity(data.identity)

    const payloadData: any = {
      identity: data.identity,
      displayName: data.displayName,
      folder: data.folderId ?? null,
      active: data.active ?? true,
      schema: this.toSchema(data.model),
    }
    if (data.author != null && data.author !== '')
      payloadData.author = data.author

    if (!existing) {
      const created = await this.http.post(
        `/api/${this.collection}`,
        payloadData,
      )
      return this.map(created)
    } else {
      const updated = await this.http.patch(
        `/api/${this.collection}/${existing.id}`,
        payloadData,
      )
      return this.map(updated)
    }
  }

  async updateMeta(
    ids: string[],
    meta: Partial<{
      displayName: string
      identity: string
      folderId: string | null
      author?: string
    }>,
  ): Promise<void> {
    const payload: any = {}
    if (meta.displayName) payload.displayName = meta.displayName
    if (meta.identity) payload.identity = meta.identity
    if ('folderId' in meta) payload.folder = meta.folderId ?? null
    if (meta.author) payload.author = meta.author

    for (const id of ids)
      await this.http.patch(`/api/${this.collection}/${id}`, payload)
  }

  async softDelete(ids: string[]): Promise<void> {
    const now = new Date().toISOString()

    for (const id of ids)
      await this.http.patch(`/api/${this.collection}/${id}`, {
        deletedAt: now,
        active: false,
      })
  }

  async setActive(ids: string[], active: boolean): Promise<void> {
    for (const id of ids)
      await this.http.patch(`/api/${this.collection}/${id}`, { active })
  }
}
