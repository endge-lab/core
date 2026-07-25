import type { AxiosInstance } from 'axios'

export interface UpdatesPayloadFields {
  identity: string
  displayName: string
  description?: string | null
  store: string | number
  source: string
  sourceVersion: number
  meta?: Record<string, unknown>
  author?: string | null
  active?: boolean
  deletedAt?: string | null
}

/** Репозиторий Store-owned Payload-коллекции updates. */
export class Updates_Repository {
  public constructor(private readonly api: AxiosInstance) {}

  public async findByIdentity(identity: string) {
    const response = await this.api.get('/updates', { params: { 'where[identity][equals]': identity, limit: 1, depth: 1 } })
    return response.data.docs?.[0] ?? null
  }

  public async findAll(params: Record<string, any> = {}) {
    const response = await this.api.get('/updates', { params: { limit: 0, sort: 'identity', depth: 1, ...params } })
    return response.data.docs ?? []
  }

  public async create(data: UpdatesPayloadFields) {
    const response = await this.api.post('/updates', normalizePayload(data))
    return response.data
  }

  public async update(id: string | number, data: Partial<UpdatesPayloadFields>) {
    const response = await this.api.patch(`/updates/${id}`, normalizePayload(data))
    return response.data
  }

  public async upsert(data: UpdatesPayloadFields) {
    const existing = await this.findByIdentity(data.identity)
    return existing ? this.update(existing.id, data) : this.create(data)
  }

  public async softDelete(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (existing)
      await this.api.patch(`/updates/${existing.id}`, { deletedAt: new Date().toISOString() })
  }

  public async hardDelete(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (existing)
      await this.api.delete(`/updates/${existing.id}`)
  }

  public async restore(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (existing)
      await this.api.patch(`/updates/${existing.id}`, { deletedAt: null, active: true })
  }
}

function normalizePayload<T extends Record<string, any>>(data: T): Partial<T> {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as Partial<T>
}
