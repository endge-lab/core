import type { AxiosInstance } from 'axios'

export interface PolicyDoc {
  id: number | string
  identity: string
  displayName: string
  description?: string | null
  folder?: number | string
}

export class Policies_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findByIdentity(identity: string): Promise<PolicyDoc | null> {
    const r = await this.api.get('/policies', {
      params: {
        limit: 1,
        'where[identity][equals]': identity,
      },
    })
    return r.data?.docs?.[0] ?? null
  }

  async findAll(params: Record<string, unknown> = {}): Promise<PolicyDoc[]> {
    const r = await this.api.get('/policies', {
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
    description?: string | null
    folder?: number | string
  }): Promise<PolicyDoc> {
    const r = await this.api.post('/policies', data)
    return r.data
  }

  async update(
    id: number | string,
    data: Partial<{
      identity: string
      displayName: string
      description: string | null
      folder: number | string
    }>,
  ): Promise<PolicyDoc> {
    const r = await this.api.patch(`/policies/${id}`, data)
    return r.data
  }

  async patchFolder(documentPayloadId: number | string, folderPayloadId: number | string | null): Promise<PolicyDoc | null> {
    const r = await this.api.patch(`/policies/${documentPayloadId}`, { folder: folderPayloadId })
    return r.data
  }

  async changeFolder(identity: string, folderPayloadId: number | string | null): Promise<PolicyDoc | null> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return null
    return this.patchFolder((existing as any).id, folderPayloadId)
  }

  async hardDelete(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.delete(`/policies/${(existing as any).id}`)
  }

  async upsert(data: {
    identity: string
    displayName: string
    description?: string | null
    folder?: number | string
  }): Promise<PolicyDoc> {
    const existing = await this.findByIdentity(data.identity)
    if (!existing)
      return this.create(data)
    return this.update((existing as any).id, {
      displayName: data.displayName,
      description: data.description ?? null,
      folder: data.folder,
    })
  }
}
