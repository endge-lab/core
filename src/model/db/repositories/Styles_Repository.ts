import type { AxiosInstance } from 'axios'

export interface StyleDoc {
  id: number | string
  identity: string
  displayName: string
  styles: Record<string, unknown>
  folder?: number | string
  project?: number | string
  isSystem?: boolean
  inherited?: boolean
  meta?: Record<string, unknown>
}

export class Styles_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findByIdentity(identity: string): Promise<StyleDoc | null> {
    const r = await this.api.get('/styles', {
      params: {
        limit: 1,
        'where[identity][equals]': identity,
      },
    })
    return r.data?.docs?.[0] ?? null
  }

  async findAll(params: Record<string, unknown> = {}): Promise<StyleDoc[]> {
    const r = await this.api.get('/styles', {
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
    styles?: Record<string, unknown>
    folder?: number | string
    project?: number | string
    isSystem?: boolean
    inherited?: boolean
    meta?: Record<string, unknown>
  }): Promise<StyleDoc> {
    const r = await this.api.post('/styles', {
      ...data,
      styles: data.styles ?? {},
    })
    return r.data
  }

  async update(
    id: number | string,
    data: Partial<{
      identity: string
      displayName: string
      styles: Record<string, unknown>
      folder: number | string
      project: number | string
      isSystem: boolean
      inherited: boolean
      meta: Record<string, unknown>
    }>,
  ): Promise<StyleDoc> {
    const r = await this.api.patch(`/styles/${id}`, data)
    return r.data
  }

  async patchFolder(documentPayloadId: number | string, folderPayloadId: number | string | null): Promise<StyleDoc | null> {
    const r = await this.api.patch(`/styles/${documentPayloadId}`, { folder: folderPayloadId })
    return r.data
  }

  async changeFolder(identity: string, folderPayloadId: number | string | null): Promise<StyleDoc | null> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return null
    return this.patchFolder((existing as any).id, folderPayloadId)
  }

  async hardDelete(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.delete(`/styles/${(existing as any).id}`)
  }

  async upsert(data: {
    identity: string
    displayName: string
    styles?: Record<string, unknown>
    folder?: number | string
    project?: number | string
    isSystem?: boolean
    inherited?: boolean
    meta?: Record<string, unknown>
  }): Promise<StyleDoc> {
    const existing = await this.findByIdentity(data.identity)
    if (!existing)
      return this.create(data)
    return this.update((existing as any).id, {
      displayName: data.displayName,
      styles: data.styles ?? {},
      folder: data.folder,
      project: data.project,
      ...(data.isSystem !== undefined && { isSystem: data.isSystem }),
      ...(data.inherited !== undefined && { inherited: data.inherited }),
      ...(data.meta !== undefined && { meta: data.meta }),
    })
  }
}
