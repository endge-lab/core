// app/repositories/Scenarios_Repository.ts
import type { AxiosInstance } from 'axios'

export class Scenarios_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findByIdentity(identity: string) {
    const r = await this.api.get('/scenarios', {
      params: { 'where[identity][equals]': identity, limit: 1 },
    })
    return r.data.docs?.[0] ?? null
  }

  async findAll(params: Record<string, any> = {}) {
    const r = await this.api.get('/scenarios', {
      params: {
        limit: 0,
        sort: 'identity',
        ...params,
      },
    })

    return r.data.docs ?? []
  }

  async create(data: {
    identity: string
    displayName: string
    schema: any
    folder?: string
    author?: string
    active?: boolean
    meta?: Record<string, unknown>
  }) {
    const r = await this.api.post('/scenarios', { ...data, meta: data.meta ?? {} })
    return r.data
  }

  /** PATCH по id документа (Payload в URL ожидает id, не identity). */
  async update(
    id: number | string,
    data: Partial<{
      identity: string
      displayName: string
      schema: any
      folder: string
      author?: string
      active: boolean
      meta: Record<string, unknown>
    }>,
  ) {
    const r = await this.api.patch(`/scenarios/${id}`, data)
    return r.data
  }

  async upsert(data: {
    identity: string
    displayName: string
    schema: any
    folder?: string
    author?: string
    active?: boolean
    meta?: Record<string, unknown>
  }) {
    const existing = await this.findByIdentity(data.identity)
    if (!existing) return this.create(data)
    return this.update(existing.id, data)
  }

  async patchFolder(documentPayloadId: number | string, folderPayloadId: number | string | null): Promise<any> {
    const r = await this.api.patch(`/scenarios/${documentPayloadId}`, { folder: folderPayloadId })
    return r.data
  }

  async changeFolder(identity: string, folderPayloadId: number | string | null): Promise<any> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return null
    return this.patchFolder((existing as any).id, folderPayloadId)
  }

  /** Мягкое удаление: find по identity, затем PATCH по id документа. */
  async softDelete(identity: string, folderId?: number | string) {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.patch(`/scenarios/${existing.id}`, {
      deletedAt: new Date().toISOString(),
      ...(folderId != null && { folder: folderId }),
    })
  }

  async hardDelete(identity: string) {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.delete(`/scenarios/${existing.id}`)
  }

  async restore(identity: string) {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.patch(`/scenarios/${existing.id}`, { deletedAt: null, folder: null })
  }
}
