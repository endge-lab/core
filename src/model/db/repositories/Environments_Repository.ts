import type { AxiosInstance } from 'axios'

export interface EnvironmentDoc {
  id: number | string
  identity: string
  displayName: string
  folder?: number | string
  isSystem?: boolean
  configuration?: import('@/domain/types/configuration').EndgeConfigurationContribution
}

export class Environments_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findByIdentity(identity: string): Promise<EnvironmentDoc | null> {
    const r = await this.api.get('/environments', {
      params: {
        limit: 1,
        'where[identity][equals]': identity,
      },
    })
    return r.data?.docs?.[0] ?? null
  }

  async findAll(params: Record<string, unknown> = {}): Promise<EnvironmentDoc[]> {
    const r = await this.api.get('/environments', {
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
    isSystem?: boolean
    configuration?: import('@/domain/types/configuration').EndgeConfigurationContribution
  }): Promise<EnvironmentDoc> {
    const r = await this.api.post('/environments', data)
    return r.data
  }

  async update(
    id: number | string,
    data: Partial<{
      identity: string
      displayName: string
      folder: number | string
      isSystem: boolean
      configuration: import('@/domain/types/configuration').EndgeConfigurationContribution
    }>,
  ): Promise<EnvironmentDoc> {
    const r = await this.api.patch(`/environments/${id}`, data)
    return r.data
  }

  async patchFolder(documentPayloadId: number | string, folderPayloadId: number | string | null): Promise<EnvironmentDoc | null> {
    const r = await this.api.patch(`/environments/${documentPayloadId}`, { folder: folderPayloadId })
    return r.data
  }

  async changeFolder(identity: string, folderPayloadId: number | string | null): Promise<EnvironmentDoc | null> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return null
    return this.patchFolder((existing as any).id, folderPayloadId)
  }

  async hardDelete(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.delete(`/environments/${(existing as any).id}`)
  }

  async upsert(data: {
    identity: string
    displayName: string
    folder?: number | string
    isSystem?: boolean
    configuration?: import('@/domain/types/configuration').EndgeConfigurationContribution
  }): Promise<EnvironmentDoc> {
    const existing = await this.findByIdentity(data.identity)
    if (!existing)
      return this.create(data)
    return this.update((existing as any).id, {
      displayName: data.displayName,
      folder: data.folder,
      ...(data.isSystem !== undefined && { isSystem: data.isSystem }),
      ...(data.configuration !== undefined && { configuration: data.configuration }),
    })
  }
}
