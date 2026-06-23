import type { AxiosInstance } from 'axios'

export class Settings_Repository {
  constructor(private api: AxiosInstance) {}

  /** Найти одну запись настроек по identity */
  async findByIdentity(identity: string): Promise<any> {
    const r = await this.api.get('/settings', {
      params: { 'where[identity][equals]': identity, limit: 1 },
    })
    return r.data.docs?.[0] ?? null
  }

  /** Получить все настройки */
  async findAll(params: Record<string, any> = {}): Promise<any> {
    const r = await this.api.get('/settings', {
      params: {
        limit: 0,
        sort: 'identity',
        ...params,
      },
    })

    return r.data.docs ?? []
  }

  async create(data: {
    identity: string
    displayName: string
    project?: string | null
    vars?: any[]
    auth?: any
    vocabs?: any[]
    updates?: any[]
    sse?: Record<string, unknown>
    customSections?: any[]
    deletedAt?: string | null
  }): Promise<any> {
    const r = await this.api.post('/settings', data)
    return r.data
  }

  /** PATCH по id документа (Payload в URL ожидает id, не identity). */
  async update(
    id: number | string,
    data: Partial<{
      identity: string
      displayName: string
      project: string | null
      vars: any[]
      auth: any
      vocabs: any[]
      updates: any[]
      sse: Record<string, unknown>
      customSections: any[]
      deletedAt: string | null
    }>,
  ): Promise<any> {
    const r = await this.api.patch(`/settings/${id}`, data)
    return r.data
  }

  async upsert(data: {
    identity: string
    displayName: string
    project?: string | null
    vars?: any[]
    auth?: any
    vocabs?: any[]
    updates?: any[]
    sse?: Record<string, unknown>
    customSections?: any[]
    deletedAt?: string | null
  }): Promise<any> {
    const existing = await this.findByIdentity(data.identity)
    if (!existing) return this.create(data)
    return this.update(existing.id, data)
  }

  /** Мягкое удаление: find по identity, затем PATCH по id документа. */
  async softDelete(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.patch(`/settings/${existing.id}`, {
      deletedAt: new Date().toISOString(),
    })
  }
}
