import type { AxiosInstance } from 'axios'
import type { ActionFlowDefinition } from '@/domain/types/flow/endge-flow.types'

export interface ActionRepositoryFieldContract {
  type: number | string | null
  isArray?: boolean
  optional?: boolean
}

export interface ActionRepositoryPayload {
  identity: string
  displayName: string
  description?: string | null
  definition: ActionFlowDefinition
  input?: ActionRepositoryFieldContract | null
  output?: ActionRepositoryFieldContract | null
  folder?: number | string | null
  author?: string
  active?: boolean
}

export class Actions_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findByIdentity(identity: string) {
    const r = await this.api.get('/actions', {
      params: { 'where[identity][equals]': identity, 'limit': 1 },
    })
    return r.data.docs?.[0] ?? null
  }

  async findAll(params: Record<string, any> = {}) {
    const r = await this.api.get('/actions', {
      params: {
        limit: 0,
        sort: 'identity',
        ...params,
      },
    })
    return r.data.docs ?? []
  }

  async create(data: ActionRepositoryPayload) {
    const r = await this.api.post('/actions', data)
    return r.data
  }

  /** PATCH по id документа (Payload в URL ожидает id, не identity). */
  async update(
    id: number | string,
    data: Partial<ActionRepositoryPayload>,
  ) {
    const r = await this.api.patch(`/actions/${id}`, data)
    return r.data
  }

  async upsert(data: ActionRepositoryPayload) {
    const existing = await this.findByIdentity(data.identity)
    if (!existing)
      return this.create(data)
    return this.update(existing.id, data)
  }

  async patchFolder(documentPayloadId: number | string, folderPayloadId: number | string | null): Promise<any> {
    const r = await this.api.patch(`/actions/${documentPayloadId}`, { folder: folderPayloadId })
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
    await this.api.patch(`/actions/${existing.id}`, {
      deletedAt: new Date().toISOString(),
      ...(folderId != null && { folder: folderId }),
    })
  }

  async hardDelete(identity: string) {
    const existing = await this.findByIdentity(identity)
    if (!existing)
      return
    await this.api.delete(`/actions/${existing.id}`)
  }

  async restore(identity: string) {
    const existing = await this.findByIdentity(identity)
    if (!existing)
      return
    await this.api.patch(`/actions/${existing.id}`, { deletedAt: null, folder: null })
  }
}
