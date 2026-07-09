import type { AxiosInstance } from 'axios'

export interface VocabDoc {
  id: number | string
  identity: string
  displayName: string
  description?: string | null
  mode: 'external_payload' | 'internal'
  baseApiUrl?: string | null
  collectionSlug?: string | null
  authMode?: 'inherit' | 'profile' | 'manual' | 'none'
  authProfileIdentity?: string | null
  active?: boolean
  folder?: number | string | null
  deletedAt?: string | null
  meta?: Record<string, unknown>
}

export class Vocabs_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findByIdentity(identity: string): Promise<VocabDoc | null> {
    const r = await this.api.get('/vocabs', {
      params: {
        limit: 1,
        'where[identity][equals]': identity,
      },
    })
    return r.data?.docs?.[0] ?? null
  }

  async findAll(params: Record<string, unknown> = {}): Promise<VocabDoc[]> {
    const r = await this.api.get('/vocabs', {
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
    mode: 'external_payload' | 'internal'
    baseApiUrl?: string | null
    collectionSlug?: string | null
    authMode?: 'inherit' | 'profile' | 'manual' | 'none'
    authProfileIdentity?: string | null
    active?: boolean
    folder?: number | string | null
    deletedAt?: string | null
    meta?: Record<string, unknown>
  }): Promise<VocabDoc> {
    const r = await this.api.post('/vocabs', {
      ...data,
      meta: data.meta ?? {},
    })
    return r.data
  }

  async update(
    id: number | string,
    data: Partial<{
      identity: string
      displayName: string
      description: string | null
      mode: 'external_payload' | 'internal'
      baseApiUrl: string | null
      collectionSlug: string | null
      authMode: 'inherit' | 'profile' | 'manual' | 'none'
      authProfileIdentity: string | null
      active: boolean
      folder: number | string | null
      deletedAt: string | null
      meta: Record<string, unknown>
    }>,
  ): Promise<VocabDoc> {
    const r = await this.api.patch(`/vocabs/${id}`, data)
    return r.data
  }

  async upsert(data: {
    identity: string
    displayName: string
    description?: string | null
    mode: 'external_payload' | 'internal'
    baseApiUrl?: string | null
    collectionSlug?: string | null
    authMode?: 'inherit' | 'profile' | 'manual' | 'none'
    authProfileIdentity?: string | null
    active?: boolean
    folder?: number | string | null
    deletedAt?: string | null
    meta?: Record<string, unknown>
  }): Promise<VocabDoc> {
    const existing = await this.findByIdentity(data.identity)
    if (!existing)
      return this.create(data)
    return this.update(existing.id, {
      displayName: data.displayName,
      description: data.description ?? null,
      mode: data.mode,
      baseApiUrl: data.baseApiUrl ?? null,
      collectionSlug: data.collectionSlug ?? null,
      authMode: data.authMode ?? 'inherit',
      authProfileIdentity: data.authProfileIdentity ?? null,
      active: data.active !== false,
      folder: data.folder ?? null,
      deletedAt: data.deletedAt ?? null,
      meta: data.meta ?? {},
    })
  }

  async patchFolder(documentPayloadId: number | string, folderId: number | string | null): Promise<VocabDoc | null> {
    const r = await this.api.patch(`/vocabs/${documentPayloadId}`, { folder: folderId })
    return r.data
  }

  async changeFolder(identity: string, folderId: number | string | null): Promise<VocabDoc | null> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return null
    return this.patchFolder((existing as any).id, folderId)
  }

  async hardDelete(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (!existing)
      return
    await this.api.delete(`/vocabs/${existing.id}`)
  }
}
