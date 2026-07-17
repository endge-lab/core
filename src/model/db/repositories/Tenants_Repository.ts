import type { AxiosInstance } from 'axios'

export interface TenantDoc {
  id: number | string
  identity: string
  displayName: string
  code: string
  description?: string | null
  folder?: number | string
  configuration?: import('@/domain/types/configuration').EndgeConfigurationContribution
}

export class Tenants_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findByIdentity(identity: string): Promise<TenantDoc | null> {
    const r = await this.api.get('/tenants', {
      params: {
        limit: 1,
        'where[identity][equals]': identity,
      },
    })
    return r.data?.docs?.[0] ?? null
  }

  async findAll(params: Record<string, unknown> = {}): Promise<TenantDoc[]> {
    const r = await this.api.get('/tenants', {
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
    code: string
    description?: string | null
    folder?: number | string
    configuration?: import('@/domain/types/configuration').EndgeConfigurationContribution
  }): Promise<TenantDoc> {
    const r = await this.api.post('/tenants', data)
    return r.data
  }

  async update(
    id: number | string,
    data: Partial<{
      identity: string
      displayName: string
      code: string
      description: string | null
      folder: number | string
      configuration: import('@/domain/types/configuration').EndgeConfigurationContribution
    }>,
  ): Promise<TenantDoc> {
    const r = await this.api.patch(`/tenants/${id}`, data)
    return r.data
  }

  async patchFolder(documentPayloadId: number | string, folderPayloadId: number | string | null): Promise<TenantDoc | null> {
    const r = await this.api.patch(`/tenants/${documentPayloadId}`, { folder: folderPayloadId })
    return r.data
  }

  async changeFolder(identity: string, folderPayloadId: number | string | null): Promise<TenantDoc | null> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return null
    return this.patchFolder((existing as any).id, folderPayloadId)
  }

  async hardDelete(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (!existing)
      return
    await this.api.delete(`/tenants/${existing.id}`)
  }

  async upsert(data: {
    identity: string
    displayName: string
    code: string
    description?: string | null
    folder?: number | string
    configuration?: import('@/domain/types/configuration').EndgeConfigurationContribution
  }): Promise<TenantDoc> {
    const existing = await this.findByIdentity(data.identity)
    if (!existing)
      return this.create(data)
    return this.update(existing.id, {
      displayName: data.displayName,
      code: data.code,
      description: data.description ?? null,
      folder: data.folder,
      configuration: data.configuration,
    })
  }
}
