import type { AxiosInstance } from 'axios'
import type { ManagedBy } from '@/domain/types/document'

export interface PageTemplatePreviewDoc {
  rows: string[][]
  rowHeights?: ('short' | 'normal' | 'tall')[]
}

export interface PageTemplateDoc {
  id: number | string
  identity: string
  displayName: string
  description?: string | null
  folder?: number | string
  managedBy?: ManagedBy
  managedById?: string | null
  areas?: Array<{
    identity: string
    title?: string | null
    description?: string | null
  }>
  preview?: PageTemplatePreviewDoc | null
  meta?: Record<string, unknown>
}

export class PageTemplates_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findByIdentity(identity: string): Promise<PageTemplateDoc | null> {
    const r = await this.api.get('/page-templates', {
      params: {
        limit: 1,
        'where[identity][equals]': identity,
      },
    })
    return r.data?.docs?.[0] ?? null
  }

  async findAll(params: Record<string, any> = {}): Promise<PageTemplateDoc[]> {
    const r = await this.api.get('/page-templates', {
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
    areas?: PageTemplateDoc['areas']
    preview?: PageTemplatePreviewDoc | null
    meta?: Record<string, unknown>
  }): Promise<PageTemplateDoc> {
    const r = await this.api.post('/page-templates', { ...data, meta: data.meta ?? {} })
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
      areas: PageTemplateDoc['areas']
      preview: PageTemplatePreviewDoc | null
      meta: Record<string, unknown>
    }>,
  ): Promise<PageTemplateDoc> {
    const r = await this.api.patch(`/page-templates/${id}`, data)
    return r.data
  }

  async upsert(data: {
    identity: string
    displayName: string
    description?: string | null
    folder?: number | string
    managedBy?: ManagedBy
    managedById?: string | null
    areas?: PageTemplateDoc['areas']
    preview?: PageTemplatePreviewDoc | null
    meta?: Record<string, unknown>
  }): Promise<PageTemplateDoc> {
    const existing = await this.findByIdentity(data.identity)
    if (!existing) return this.create(data)
    return this.update(existing.id, {
      displayName: data.displayName,
      description: data.description ?? null,
      folder: data.folder,
      ...(data.managedBy !== undefined && { managedBy: data.managedBy }),
      ...(data.managedById !== undefined && { managedById: data.managedById }),
      ...(data.areas !== undefined && { areas: data.areas }),
      ...(data.preview !== undefined && { preview: data.preview }),
      ...(data.meta !== undefined && { meta: data.meta }),
    })
  }
}
