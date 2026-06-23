import type { AxiosInstance } from 'axios'

export interface I18nBundleDoc {
  id: number | string
  identity: string
  displayName: string
  description?: string | null
  locales: Record<string, Record<string, unknown>>
  active?: boolean
  folder?: number | string | null
  deletedAt?: string | null
}

export class I18nBundles_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findByIdentity(identity: string): Promise<I18nBundleDoc | null> {
    const r = await this.api.get('/i18n-bundles', {
      params: {
        limit: 1,
        'where[identity][equals]': identity,
      },
    })
    return r.data?.docs?.[0] ?? null
  }

  async findAll(params: Record<string, unknown> = {}): Promise<I18nBundleDoc[]> {
    const r = await this.api.get('/i18n-bundles', {
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
    locales?: Record<string, Record<string, unknown>>
    active?: boolean
    folder?: number | string | null
    deletedAt?: string | null
  }): Promise<I18nBundleDoc> {
    const r = await this.api.post('/i18n-bundles', {
      ...data,
      locales: data.locales ?? {},
    })
    return r.data
  }

  async update(
    id: number | string,
    data: Partial<{
      identity: string
      displayName: string
      description: string | null
      locales: Record<string, Record<string, unknown>>
      active: boolean
      folder: number | string | null
      deletedAt: string | null
    }>,
  ): Promise<I18nBundleDoc> {
    const r = await this.api.patch(`/i18n-bundles/${id}`, data)
    return r.data
  }

  async upsert(data: {
    identity: string
    displayName: string
    description?: string | null
    locales?: Record<string, Record<string, unknown>>
    active?: boolean
    folder?: number | string | null
    deletedAt?: string | null
  }): Promise<I18nBundleDoc> {
    const existing = await this.findByIdentity(data.identity)
    if (!existing)
      return this.create(data)
    return this.update(existing.id, {
      displayName: data.displayName,
      description: data.description ?? null,
      locales: data.locales ?? {},
      active: data.active !== false,
      folder: data.folder ?? null,
      deletedAt: data.deletedAt ?? null,
    })
  }

  async patchFolder(documentPayloadId: number | string, folderId: number | string | null): Promise<I18nBundleDoc | null> {
    const r = await this.api.patch(`/i18n-bundles/${documentPayloadId}`, { folder: folderId })
    return r.data
  }

  async changeFolder(identity: string, folderId: number | string | null): Promise<I18nBundleDoc | null> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return null
    return this.patchFolder((existing as any).id, folderId)
  }

  async hardDelete(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (!existing)
      return
    await this.api.delete(`/i18n-bundles/${existing.id}`)
  }
}
