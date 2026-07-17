import type { AxiosInstance } from 'axios'

export interface ComputationsPayloadFields {
  identity: string
  displayName: string
  description?: string | null
  source: string
  sourceVersion: number
  contractVersion: number
  input?: Record<string, unknown> | null
  output?: Record<string, unknown> | null
  folder?: string | number | null
  meta?: Record<string, unknown>
  author?: string | null
  active?: boolean
  deletedAt?: string | null
}

/** Repository for the Payload computations collection. */
export class Computations_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findByIdentity(identity: string) {
    const response = await this.api.get('/computations', {
      params: { 'where[identity][equals]': identity, limit: 1, depth: 1 },
    })
    return response.data.docs?.[0] ?? null
  }

  async findAll(params: Record<string, any> = {}) {
    const response = await this.api.get('/computations', {
      params: { limit: 0, sort: 'identity', depth: 1, ...params },
    })
    return response.data.docs ?? []
  }

  async create(data: ComputationsPayloadFields) {
    const response = await this.api.post('/computations', normalizePayload(data))
    return response.data
  }

  async update(id: string | number, data: Partial<ComputationsPayloadFields>) {
    const response = await this.api.patch(`/computations/${id}`, normalizePayload(data))
    return response.data
  }

  async upsert(data: ComputationsPayloadFields) {
    const existing = await this.findByIdentity(data.identity)
    return existing ? this.update(existing.id, data) : this.create(data)
  }

  async patchFolder(id: string | number, folder: string | number | null) {
    const response = await this.api.patch(`/computations/${id}`, { folder })
    return response.data
  }

  async softDelete(identity: string, folder?: string | number): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (existing) {
      await this.api.patch(`/computations/${existing.id}`, {
        active: false,
        deletedAt: new Date().toISOString(),
        ...(folder != null && { folder }),
      })
    }
  }

  async hardDelete(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (existing)
      await this.api.delete(`/computations/${existing.id}`)
  }

  async restore(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (existing)
      await this.api.patch(`/computations/${existing.id}`, { active: true, deletedAt: null, folder: null })
  }
}

function normalizePayload<T extends Record<string, any>>(data: T): Partial<T> {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as Partial<T>
}
