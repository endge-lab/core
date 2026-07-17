import type { AxiosInstance } from 'axios'

export interface FilterDoc {
  id: string
  identity: string
  displayName: string
  /** Id папки в Payload (relationship). */
  folder?: number | string
  active: boolean
  deletedAt?: string | null
  author?: string | null
  fields: any[]
  source: string
  sourceVersion: number
}

export class Filters_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findByIdentity(identity: string): Promise<FilterDoc | null> {
    const r = await this.api.get('/filters', {
      params: {
        limit: 1,
        'where[identity][equals]': identity,
      },
    })
    return r.data?.docs?.[0] ?? null
  }

  async findAll(params: Record<string, any> = {}): Promise<FilterDoc[]> {
    const r = await this.api.get('/filters', {
      params: {
        limit: 0,
        sort: 'identity',
        ...params,
      },
    })
    return r.data?.docs ?? []
  }

  async create(data: {
    identity: string
    displayName: string
    folder?: number | string
    author?: string | null
    active?: boolean
    fields?: any[]
    source?: string
    sourceVersion?: number
    meta?: Record<string, unknown>
  }): Promise<FilterDoc> {
    const r = await this.api.post('/filters', { ...data, meta: data.meta ?? {} })
    return r.data
  }

  /** PATCH по id документа (Payload в URL ожидает id, не identity). */
  async update(
    id: number | string,
    data: Partial<{
      identity: string
      displayName: string
      folder: number | string
      author: string | null
      active: boolean
      fields: any[]
      source: string
      sourceVersion: number
      meta: Record<string, unknown>
    }>,
  ): Promise<FilterDoc> {
    const r = await this.api.patch(`/filters/${id}`, data)
    return r.data
  }

  async upsert(data: {
    identity: string
    displayName: string
    folder?: number | string
    author?: string | null
    active?: boolean
    fields?: any[]
    source?: string
    sourceVersion?: number
    meta?: Record<string, unknown>
  }): Promise<FilterDoc> {
    const existing = await this.findByIdentity(data.identity)
    if (!existing) return this.create(data)
    return this.update(existing.id, data)
  }

  /** Только смена папки: PATCH с полем folder. Возвращает обновлённый документ. */
  async patchFolder(documentPayloadId: number | string, folderPayloadId: number | string | null): Promise<any> {
    const r = await this.api.patch(`/filters/${documentPayloadId}`, { folder: folderPayloadId })
    return r.data
  }

  async changeFolder(identity: string, folderPayloadId: number | string | null): Promise<any> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return null
    return this.patchFolder((existing as any).id, folderPayloadId)
  }

  /** Мягкое удаление: find по identity, затем PATCH по id документа. */
  async softDelete(identity: string, folderId?: number | string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.patch(`/filters/${existing.id}`, {
      deletedAt: new Date().toISOString(),
      ...(folderId != null && { folder: folderId }),
    })
  }

  async hardDelete(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.delete(`/filters/${existing.id}`)
  }

  async restore(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.patch(`/filters/${existing.id}`, { deletedAt: null, folder: null })
  }
}
