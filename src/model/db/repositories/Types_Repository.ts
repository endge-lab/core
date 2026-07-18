// app/repositories/Types_Repository.ts
import type { ManagedBy } from '@/domain/types/document'
import type { AxiosInstance } from 'axios'

export class Types_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findByIdentity(identity: string) {
    const r = await this.api.get('/types', {
      params: { 'where[identity][equals]': identity, 'limit': 1 },
    })
    return r.data.docs?.[0] ?? null
  }

  async findAll(params: Record<string, any> = {}) {
    const r = await this.api.get('/types', {
      params: {
        sort: 'identity',
        limit: 0,
        ...params,
      },
    })
    return r.data.docs ?? []
  }

  async create(data: {
    identity: string
    displayName: string
    schema: any
    author?: string
    folder?: string
    active?: boolean
    isPrimitive?: boolean
    managedBy?: ManagedBy
    managedById?: string | null
    meta?: Record<string, unknown>
  }) {
    const r = await this.api.post('/types', { ...data, meta: data.meta ?? {} })
    return r.data
  }

  /** PATCH по id документа (Payload в URL ожидает id, не identity). */
  async update(
    id: number | string,
    data: Partial<{
      identity: string
      displayName: string
      schema: any
      author?: string
      folder: string
      active: boolean
      isPrimitive: boolean
      managedBy: ManagedBy
      managedById: string | null
      meta: Record<string, unknown>
    }>,
  ) {
    const r = await this.api.patch(`/types/${id}`, data)
    return r.data
  }

  async upsert(data: {
    identity: string
    displayName: string
    schema: any
    author?: string
    folder?: string
    active?: boolean
    isPrimitive?: boolean
    managedBy?: ManagedBy
    managedById?: string | null
    meta?: Record<string, unknown>
  }) {
    const existing = await this.findByIdentity(data.identity)
    if (!existing)
      return this.create(data)
    return this.update(existing.id, data)
  }

  /** Только смена папки: PATCH с полем folder. Возвращает обновлённый документ. */
  async patchFolder(documentPayloadId: number | string, folderPayloadId: number | string | null): Promise<any> {
    const r = await this.api.patch(`/types/${documentPayloadId}`, { folder: folderPayloadId })
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
    if (!existing)
      return
    await this.api.patch(`/types/${existing.id}`, {
      deletedAt: new Date().toISOString(),
      ...(folderId != null && { folder: folderId }),
    })
  }

  async hardDelete(identity: string) {
    const existing = await this.findByIdentity(identity)
    if (!existing)
      return
    await this.api.delete(`/types/${existing.id}`)
  }

  async restore(identity: string) {
    const existing = await this.findByIdentity(identity)
    if (!existing)
      return
    await this.api.patch(`/types/${existing.id}`, { deletedAt: null, folder: null })
  }
}
