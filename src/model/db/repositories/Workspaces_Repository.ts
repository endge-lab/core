import type { AxiosInstance } from 'axios'

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
}
