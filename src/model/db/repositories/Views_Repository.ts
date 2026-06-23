import type { AxiosInstance } from 'axios'

export interface ViewDoc {
  id: number | string
  identity: string
  displayName: string
  description?: string | null
  folder?: number | string
  isSystem?: boolean
  component?: number | string | { id: number | string; identity?: string }
  filter?: number | string | { id: number | string; identity?: string }
  query?: number | string | { id: number | string; identity?: string }
}

export class Views_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findByIdentity(identity: string): Promise<ViewDoc | null> {
    const r = await this.api.get('/views', {
      params: {
        limit: 1,
        'where[identity][equals]': identity,
      },
    })
    return r.data?.docs?.[0] ?? null
  }

  async findAll(params: Record<string, any> = {}): Promise<ViewDoc[]> {
    const r = await this.api.get('/views', {
      params: {
        limit: 0,
        sort: 'identity',
        depth: 1,
        ...params,
      },
    })
    return r.data?.docs ?? []
  }

  async create(data: {
    identity: string
    displayName: string
    description?: string | null
    folder?: number | string
    isSystem?: boolean
    component?: number | string
    filter?: number | string
    query?: number | string
    meta?: Record<string, unknown>
  }): Promise<ViewDoc> {
    const r = await this.api.post('/views', { ...data, meta: data.meta ?? {} })
    return r.data
  }

  /** PATCH по id документа (Payload в URL ожидает id, не identity). */
  async update(
    id: number | string,
    data: Partial<{
      identity: string
      displayName: string
      description: string | null
      folder: number | string
      isSystem: boolean
      component: number | string | null
      filter: number | string | null
      query: number | string | null
      meta: Record<string, unknown>
    }>,
  ): Promise<ViewDoc> {
    const r = await this.api.patch(`/views/${id}`, data)
    return r.data
  }

  /** Только смена папки: PATCH с полем folder. Возвращает обновлённый документ. */
  async patchFolder(documentPayloadId: number | string, folderPayloadId: number | string | null): Promise<any> {
    const r = await this.api.patch(`/views/${documentPayloadId}`, { folder: folderPayloadId })
    return r.data
  }

  async changeFolder(identity: string, folderPayloadId: number | string | null): Promise<any> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return null
    return this.patchFolder((existing as any).id, folderPayloadId)
  }

  async upsert(data: {
    identity: string
    displayName: string
    description?: string | null
    folder?: number | string
    isSystem?: boolean
    component?: number | string | null
    filter?: number | string | null
    query?: number | string | null
    meta?: Record<string, unknown>
  }): Promise<ViewDoc> {
    const existing = await this.findByIdentity(data.identity)
    if (!existing) return this.create(data)
    return this.update(existing.id, {
      displayName: data.displayName,
      description: data.description ?? null,
      folder: data.folder,
      ...(data.isSystem !== undefined && { isSystem: data.isSystem }),
      ...(data.component !== undefined && { component: data.component }),
      ...(data.filter !== undefined && { filter: data.filter }),
      ...(data.query !== undefined && { query: data.query }),
      ...(data.meta !== undefined && { meta: data.meta }),
    })
  }

  async hardDelete(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.delete(`/views/${existing.id}`)
  }
}
