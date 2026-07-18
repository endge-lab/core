import type { AxiosInstance } from 'axios'
import type { ManagedBy } from '@/domain/types/document'

/** Полиморфная связь Payload: relationTo + value (id документа коллекции). */
export interface PageAreaBlockDoc {
  key: string
  entity:
    | number
    | string
    | { id: number | string; identity?: string }
    | { relationTo: string; value: number }
  titleOverride?: string | null
  visibleWhen?: string | null
  props?: Record<string, unknown> | null
}

export interface PageAreaDoc {
  slotId: string
  blocks?: PageAreaBlockDoc[]
}

export interface PageDoc {
  id: number | string
  identity: string
  displayName: string
  description?: string | null
  folder?: number | string
  managedBy?: ManagedBy
  managedById?: string | null
  routeName?: string | null
  routePath?: string | null
  template?: number | string | { id: number | string; identity?: string }
  controller?: number | string | { id: number | string; identity?: string } | null
  enabled?: boolean
  areas?: PageAreaDoc[]
  meta?: Record<string, unknown>
}

export class Pages_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findByIdentity(identity: string): Promise<PageDoc | null> {
    const r = await this.api.get('/pages', {
      params: {
        limit: 1,
        'where[identity][equals]': identity,
      },
    })
    return r.data?.docs?.[0] ?? null
  }

  async findAll(params: Record<string, any> = {}): Promise<PageDoc[]> {
    const r = await this.api.get('/pages', {
      params: {
        limit: 0,
        sort: 'identity',
        depth: 1,
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
    managedBy?: ManagedBy
    managedById?: string | null
    routeName?: string | null
    routePath?: string | null
    template: number | string
    controller?: number | string | null
    enabled?: boolean
    areas?: PageAreaDoc[]
    meta?: Record<string, unknown>
  }): Promise<PageDoc> {
    const r = await this.api.post('/pages', { ...data, meta: data.meta ?? {} })
    return r.data
  }

  async update(
    id: number | string,
    data: Partial<{
      identity: string
      displayName: string
      description: string | null
      folder: number | string
      managedBy: ManagedBy
      managedById: string | null
      routeName: string | null
      routePath: string | null
      template: number | string | null
      controller: number | string | null
      enabled: boolean
      areas: PageAreaDoc[]
      meta: Record<string, unknown>
    }>,
  ): Promise<PageDoc> {
    const r = await this.api.patch(`/pages/${id}`, data)
    return r.data
  }

  async upsert(data: {
    identity: string
    displayName: string
    description?: string | null
    folder?: number | string
    managedBy?: ManagedBy
    managedById?: string | null
    routeName?: string | null
    routePath?: string | null
    template: number | string
    controller?: number | string | null
    enabled?: boolean
    areas?: PageAreaDoc[]
    meta?: Record<string, unknown>
  }): Promise<PageDoc> {
    const existing = await this.findByIdentity(data.identity)
    if (!existing) return this.create(data)
    return this.update(existing.id, {
      displayName: data.displayName,
      description: data.description ?? null,
      folder: data.folder,
      ...(data.managedBy !== undefined && { managedBy: data.managedBy }),
      ...(data.managedById !== undefined && { managedById: data.managedById }),
      routeName: data.routeName ?? null,
      routePath: data.routePath ?? null,
      template: data.template,
      ...(data.controller !== undefined && { controller: data.controller }),
      ...(data.enabled !== undefined && { enabled: data.enabled }),
      ...(data.areas !== undefined && { areas: data.areas }),
      ...(data.meta !== undefined && { meta: data.meta }),
    })
  }

  async hardDelete(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.delete(`/pages/${existing.id}`)
  }
}
