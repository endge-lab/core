import type { AxiosInstance } from 'axios'

export type WorkspacePayloadData = {
  identity: string
  displayName: string
  configuration: import('@/domain/types/configuration').EndgeConfiguration
}

export class Workspaces_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findAll(params: Record<string, any> = {}) {
    const requestParams = {
      limit: 0,
      sort: 'identity',
      ...params,
    }

    try {
      const r = await this.api.get('/workspaces', { params: requestParams })
      return r.data.docs ?? []
    }
    catch {
      const r = await this.api.get('/workspace', { params: requestParams })
      return r.data.docs ?? []
    }
  }

  async findByIdentity(identity: string): Promise<any | null> {
    const normalized = String(identity ?? '').trim()
    if (!normalized)
      return null

    const docs = await this.findAll({
      limit: 1,
      'where[identity][equals]': normalized,
    })

    return docs[0] ?? null
  }

  async create(data: WorkspacePayloadData) {
    const r = await this.api.post('/workspaces', data)
    return r.data
  }

  async update(id: number | string, data: Partial<WorkspacePayloadData>) {
    const r = await this.api.patch(`/workspaces/${id}`, data)
    return r.data
  }

  async upsert(data: WorkspacePayloadData) {
    const existing = await this.findByIdentity(data.identity)
    if (!existing)
      return this.create(data)
    return this.update(existing.id, data)
  }
}
