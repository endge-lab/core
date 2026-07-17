import type { AxiosInstance } from 'axios'

export interface StylesPayloadFields {
  identity: string
  displayName: string
  description?: string | null
  source: string
  sourceVersion: number
  folder?: string | number | null
  meta?: Record<string, unknown>
  author?: string | null
  active?: boolean
  deletedAt?: string | null
  inherited?: boolean
  isSystem?: boolean
}

export interface StyleDoc extends StylesPayloadFields {
  id: number | string
}

/** Payload repository for source-first EndgeCSS documents. */
export class Styles_Repository {
  public constructor(private readonly api: AxiosInstance) {}

  public async findByIdentity(identity: string): Promise<StyleDoc | null> {
    const response = await this.api.get('/styles', {
      params: {
        limit: 1,
        depth: 1,
        'where[identity][equals]': identity,
      },
    })
    return response.data?.docs?.[0] ?? null
  }

  public async findAll(params: Record<string, unknown> = {}): Promise<StyleDoc[]> {
    const response = await this.api.get('/styles', {
      params: {
        limit: 0,
        sort: 'identity',
        depth: 1,
        ...params,
      },
    })
    return response.data?.docs ?? []
  }

  public async create(data: StylesPayloadFields): Promise<StyleDoc> {
    const response = await this.api.post('/styles', normalizePayload(data))
    return response.data
  }

  public async update(id: number | string, data: Partial<StylesPayloadFields>): Promise<StyleDoc> {
    const response = await this.api.patch(`/styles/${id}`, normalizePayload(data))
    return response.data
  }

  public async upsert(data: StylesPayloadFields): Promise<StyleDoc> {
    const existing = await this.findByIdentity(data.identity)
    return existing ? this.update(existing.id, data) : this.create(data)
  }

  public async patchFolder(id: number | string, folder: number | string | null): Promise<StyleDoc> {
    const response = await this.api.patch(`/styles/${id}`, { folder })
    return response.data
  }

  public async changeFolder(identity: string, folder: number | string | null): Promise<StyleDoc | null> {
    const existing = await this.findByIdentity(identity)
    return existing ? this.patchFolder(existing.id, folder) : null
  }

  public async softDelete(identity: string, folder?: number | string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (existing)
      await this.api.patch(`/styles/${existing.id}`, { deletedAt: new Date().toISOString(), ...(folder != null && { folder }) })
  }

  public async hardDelete(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (existing)
      await this.api.delete(`/styles/${existing.id}`)
  }

  public async restore(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (existing)
      await this.api.patch(`/styles/${existing.id}`, { deletedAt: null, folder: null })
  }
}

function normalizePayload<T extends Record<string, any>>(data: T): Partial<T> {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as Partial<T>
}
