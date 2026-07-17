import type { AxiosInstance } from 'axios'

export interface CompositionsPayloadFields {
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
}

/** Репозиторий Payload-коллекции compositions. */
export class Compositions_Repository {
  public constructor(private readonly api: AxiosInstance) {}

  public async findByIdentity(identity: string) {
    const response = await this.api.get('/compositions', {
      params: { 'where[identity][equals]': identity, limit: 1, depth: 1 },
    })
    return response.data.docs?.[0] ?? null
  }

  public async findAll(params: Record<string, any> = {}) {
    const response = await this.api.get('/compositions', {
      params: { limit: 0, sort: 'identity', depth: 1, ...params },
    })
    return response.data.docs ?? []
  }

  public async create(data: CompositionsPayloadFields) {
    const response = await this.api.post('/compositions', normalizePayload(data))
    return response.data
  }

  public async update(id: string | number, data: Partial<CompositionsPayloadFields>) {
    const response = await this.api.patch(`/compositions/${id}`, normalizePayload(data))
    return response.data
  }

  public async upsert(data: CompositionsPayloadFields) {
    const existing = await this.findByIdentity(data.identity)
    return existing ? this.update(existing.id, data) : this.create(data)
  }

  public async patchFolder(id: string | number, folder: string | number | null) {
    const response = await this.api.patch(`/compositions/${id}`, { folder })
    return response.data
  }

  public async softDelete(identity: string, folder?: string | number): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (!existing)
      return
    await this.api.patch(`/compositions/${existing.id}`, {
      deletedAt: new Date().toISOString(),
      ...(folder != null && { folder }),
    })
  }

  public async hardDelete(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (existing)
      await this.api.delete(`/compositions/${existing.id}`)
  }

  public async restore(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (existing)
      await this.api.patch(`/compositions/${existing.id}`, { deletedAt: null, folder: null })
  }
}

function normalizePayload<T extends Record<string, any>>(data: T): Partial<T> {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as Partial<T>
}
