import type { AuthProfileAdapterId, AuthProfilePersist } from '@/domain/types/auth-profile.types'
import type { AxiosInstance } from 'axios'

export interface AuthProfileDoc {
  id: number | string
  identity: string
  displayName: string
  description?: string | null
  adapterId: AuthProfileAdapterId
  config?: Record<string, unknown>
  credentialRefs?: Record<string, string | undefined>
  persist?: AuthProfilePersist
  active?: boolean
  folder?: number | string | null
  deletedAt?: string | null
  meta?: Record<string, unknown>
}

export class AuthProfiles_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findByIdentity(identity: string): Promise<AuthProfileDoc | null> {
    const r = await this.api.get('/auth-profiles', {
      params: {
        limit: 1,
        'where[identity][equals]': identity,
      },
    })
    return r.data?.docs?.[0] ?? null
  }

  async findAll(params: Record<string, unknown> = {}): Promise<AuthProfileDoc[]> {
    const r = await this.api.get('/auth-profiles', {
      params: {
        limit: 0,
        sort: 'identity',
        ...params,
      },
    })
    return r.data?.docs ?? []
  }

  async create(data: Omit<AuthProfileDoc, 'id'>): Promise<AuthProfileDoc> {
    const r = await this.api.post('/auth-profiles', {
      ...data,
      config: data.config ?? {},
      credentialRefs: data.credentialRefs ?? {},
      meta: data.meta ?? {},
    })
    return r.data
  }

  async update(id: number | string, data: Partial<Omit<AuthProfileDoc, 'id'>>): Promise<AuthProfileDoc> {
    const r = await this.api.patch(`/auth-profiles/${id}`, data)
    return r.data
  }

  async upsert(data: Omit<AuthProfileDoc, 'id'>): Promise<AuthProfileDoc> {
    const existing = await this.findByIdentity(data.identity)
    if (!existing)
      return this.create(data)
    return this.update(existing.id, {
      displayName: data.displayName,
      description: data.description ?? null,
      adapterId: data.adapterId,
      config: data.config ?? {},
      credentialRefs: data.credentialRefs ?? {},
      persist: data.persist ?? 'localStorage',
      active: data.active !== false,
      folder: data.folder ?? null,
      deletedAt: data.deletedAt ?? null,
      meta: data.meta ?? {},
    })
  }

  async patchFolder(documentPayloadId: number | string, folderId: number | string | null): Promise<AuthProfileDoc | null> {
    const r = await this.api.patch(`/auth-profiles/${documentPayloadId}`, { folder: folderId })
    return r.data
  }

  async changeFolder(identity: string, folderId: number | string | null): Promise<AuthProfileDoc | null> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return null
    return this.patchFolder(existing.id, folderId)
  }

  async hardDelete(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (!existing)
      return
    await this.api.delete(`/auth-profiles/${existing.id}`)
  }
}
