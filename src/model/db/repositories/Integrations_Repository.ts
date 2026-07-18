import type { AxiosInstance } from 'axios'
import type { ManagedBy } from '@/domain/types/document'

export interface IntegrationDoc {
  id: number | string
  identity: string
  displayName: string
  description?: string | null
  managedBy?: ManagedBy
  managedById?: string | null
}

export class Integrations_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findByIdentity(identity: string): Promise<IntegrationDoc | null> {
    const r = await this.api.get('/integrations', {
      params: {
        limit: 1,
        'where[identity][equals]': identity,
      },
    })
    return r.data?.docs?.[0] ?? null
  }

  async findAll(params: Record<string, any> = {}): Promise<IntegrationDoc[]> {
    const r = await this.api.get('/integrations', {
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
    managedBy?: ManagedBy
    managedById?: string | null
  }): Promise<IntegrationDoc> {
    const r = await this.api.post('/integrations', data)
    return r.data
  }

  /** PATCH по id документа (Payload в URL ожидает id, не identity). */
  async update(
    id: number | string,
    data: Partial<{
      identity: string
      displayName: string
      description: string | null
      managedBy: ManagedBy
      managedById: string | null
    }>,
  ): Promise<IntegrationDoc> {
    const r = await this.api.patch(`/integrations/${id}`, data)
    return r.data
  }

  async upsert(data: {
    identity: string
    displayName: string
    description?: string | null
    managedBy?: ManagedBy
    managedById?: string | null
  }): Promise<IntegrationDoc> {
    const existing = await this.findByIdentity(data.identity)
    if (!existing) return this.create(data)
    return this.update(existing.id, {
      displayName: data.displayName,
      description: data.description ?? null,
      ...(data.managedBy !== undefined && { managedBy: data.managedBy }),
      ...(data.managedById !== undefined && { managedById: data.managedById }),
    })
  }
}
