import type { AxiosInstance } from 'axios'

export class Folders_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findByIdentity(identity: string) {
    const r = await this.api.get('/folders', {
      params: { 'where[identity][equals]': identity, limit: 1 },
    })
    return r.data.docs?.[0] ?? null
  }

  async findAll(params: Record<string, any> = {}) {
    const r = await this.api.get('/folders', {
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
    entityType: string
    workspace?: number | string | null
    parent?: string | null
  }) {
    const r = await this.api.post('/folders', data)
    return r.data
  }

  /** PATCH по id документа (Payload в URL ожидает id, не identity). */
  async update(id: number | string, data: Partial<{
    identity: string
    displayName: string
    entityType: string
    workspace?: number | string | null
    parent?: string | null
  }>) {
    const r = await this.api.patch(`/folders/${id}`, data)
    return r.data
  }

  async upsert(data: {
    identity: string
    displayName: string
    entityType: string
    workspace?: number | string | null
    parent?: string | null
  }) {
    const existing = await this.findByIdentity(data.identity)
    if (!existing) return this.create(data)
    return this.update(existing.id, data)
  }

  /** Удаление папки в Payload (DELETE). Перед вызовом убедиться, что дочерние перенесены. */
  async deleteByIdentity(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.delete(`/folders/${(existing as any).id}`)
  }

  /** Мягкое удаление: find по identity, затем PATCH по id документа. */
  async softDelete(identity: string) {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.patch(`/folders/${existing.id}`, {
      deletedAt: new Date().toISOString(),
    })
  }
}
