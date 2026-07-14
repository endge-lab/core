import type { AxiosInstance } from 'axios'
import type { NavigationDoc, NavigationTreeNodeDoc } from '@/domain/types/document/navigation.types'

export class Navigations_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findByIdentity(identity: string): Promise<NavigationDoc | null> {
    const r = await this.api.get('/navigations', {
      params: {
        limit: 1,
        'where[identity][equals]': identity,
      },
    })
    return r.data?.docs?.[0] ?? null
  }

  async findAll(params: Record<string, any> = {}): Promise<NavigationDoc[]> {
    const r = await this.api.get('/navigations', {
      params: {
        limit: 0,
        sort: 'identity',
        depth: 1,
        ...params,
      },
    })
    return r.data?.docs ?? []
  }

  async update(
    id: number | string,
    data: Partial<{
      identity: string
      displayName: string
      description: string | null
      folder: number | string | null
      project: number | string | null
      isSystem: boolean
      tree: NavigationTreeNodeDoc[]
      meta: Record<string, unknown>
    }>,
  ): Promise<NavigationDoc> {
    const r = await this.api.patch(`/navigations/${id}`, data)
    return r.data
  }

  async upsert(data: {
    identity: string
    displayName: string
    description?: string | null
    folder?: number | string
    project?: number | string
    isSystem?: boolean
    tree?: NavigationTreeNodeDoc[]
    meta?: Record<string, unknown>
  }): Promise<NavigationDoc> {
    const existing = await this.findByIdentity(data.identity)
    if (!existing)
      return this.create(data)
    return this.update(existing.id, {
      displayName: data.displayName,
      description: data.description ?? null,
      folder: data.folder ?? null,
      project: data.project ?? null,
      ...(data.isSystem !== undefined && { isSystem: data.isSystem }),
      ...(data.tree !== undefined && { tree: data.tree }),
      ...(data.meta !== undefined && { meta: data.meta }),
    })
  }

  async create(data: {
    identity: string
    displayName: string
    description?: string | null
    folder?: number | string
    project?: number | string
    isSystem?: boolean
    tree?: NavigationTreeNodeDoc[]
    meta?: Record<string, unknown>
  }): Promise<NavigationDoc> {
    const r = await this.api.post('/navigations', { ...data, meta: data.meta ?? {} })
    return r.data
  }

  async patchFolder(documentPayloadId: number | string, folderId: number | string | null): Promise<NavigationDoc | null> {
    const r = await this.api.patch(`/navigations/${documentPayloadId}`, { folder: folderId })
    return r.data
  }

  async changeFolder(identity: string, folderId: number | string | null): Promise<NavigationDoc | null> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return null
    return this.patchFolder((existing as any).id, folderId)
  }
}
