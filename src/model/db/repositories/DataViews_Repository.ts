import type { AxiosInstance } from 'axios'

export interface DataViewsPayloadFields {
  identity: string
  displayName: string
  description?: string | null
  source: string
  sourceVersion: number
  folder?: string | number | null
  meta?: Record<string, unknown>
  author?: string
  active?: boolean
  deletedAt?: string | null
  inherited?: boolean
}

/** Репозиторий Payload-коллекции DataViews. */
export class DataViews_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findByIdentity(identity: string) {
    const r = await this.api.get('/data-views', {
      params: { 'where[identity][equals]': identity, limit: 1, depth: 1 },
    })
    return r.data.docs?.[0] ?? null
  }

  async findAll(params: Record<string, any> = {}) {
    const r = await this.api.get('/data-views', {
      params: {
        limit: 0,
        sort: 'identity',
        depth: 1,
        ...params,
      },
    })
    return r.data.docs ?? []
  }

  async create(data: DataViewsPayloadFields) {
    const r = await this.api.post('/data-views', normalizePayload(data))
    return r.data
  }

  /** PATCH по id документа Payload. */
  async update(id: number | string, data: Partial<DataViewsPayloadFields>) {
    const r = await this.api.patch(`/data-views/${id}`, normalizePayload(data))
    return r.data
  }

  async upsert(data: DataViewsPayloadFields) {
    const existing = await this.findByIdentity(data.identity)
    if (!existing)
      return this.create(data)
    return this.update((existing as any).id, data)
  }

  /** Смена папки по Payload id документа. */
  async patchFolder(documentPayloadId: number | string, folderPayloadId: number | string | null): Promise<any> {
    const r = await this.api.patch(`/data-views/${documentPayloadId}`, { folder: folderPayloadId })
    return r.data
  }

  /** Мягкое удаление: find по identity, затем PATCH по id документа. */
  async softDelete(identity: string, folderId?: number | string) {
    const existing = await this.findByIdentity(identity)
    if (!existing)
      return
    await this.api.patch(`/data-views/${existing.id}`, {
      deletedAt: new Date().toISOString(),
      ...(folderId != null && { folder: folderId }),
    })
  }

  async hardDelete(identity: string) {
    const existing = await this.findByIdentity(identity)
    if (!existing)
      return
    await this.api.delete(`/data-views/${existing.id}`)
  }

  async restore(identity: string) {
    const existing = await this.findByIdentity(identity)
    if (!existing)
      return
    await this.api.patch(`/data-views/${existing.id}`, { deletedAt: null, folder: null })
  }
}

/** Убирает undefined, чтобы PATCH не затирал поля случайными пустыми значениями. */
function normalizePayload<T extends Record<string, any>>(data: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined)
      ;(out as Record<string, any>)[key] = value
  }
  return out
}
