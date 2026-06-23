import type { AxiosInstance } from 'axios'

export class Components_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findByIdentity(identity: string) {
    const r = await this.api.get('/components', {
      params: { 'where[identity][equals]': identity, limit: 1 },
    })
    return r.data.docs?.[0] ?? null
  }

  async findAll(params: Record<string, any> = {}) {
    const r = await this.api.get('/components', {
      params: {
        limit: 0,
        sort: 'identity',
        depth: 1,
        ...params,
      },
    })

    return r.data.docs ?? []
  }

  async create(data: {
    identity: string
    displayName: string
    schema?: any
    folder?: string | number
    author?: string
    active?: boolean
    componentType?: string
    inputFields?: any[]
    jsxScript?: string
    rowSize?: string | number
    bindings?: { keys?: any[] }
    columns?: any[]
  }) {
    const r = await this.api.post('/components', { ...data, schema: data.schema ?? {} })
    return r.data
  }

  /** PATCH по id документа (Payload в URL ожидает id, не identity). */
  async update(
    id: number | string,
    data: Partial<{
      identity: string
      displayName: string
      schema: any
      folder: string | number
      author: string
      active: boolean
      componentType: string
      inputFields: any[]
      jsxScript: string
      rowSize: string | number
      bindings: { keys?: any[] }
      columns: any[]
    }>,
  ) {
    const r = await this.api.patch(`/components/${id}`, data)
    return r.data
  }

  async upsert(data: {
    identity: string
    displayName: string
    schema?: any
    folder?: string | number
    author?: string
    active?: boolean
    componentType?: string
    inputFields?: any[]
    jsxScript?: string
    rowSize?: string | number
    bindings?: { keys?: any[] }
    columns?: any[]
  }) {
    const existing = await this.findByIdentity(data.identity)
    if (!existing) return this.create(data)
    const { schema: _s, ...updateData } = data
    return this.update((existing as any).id, updateData)
  }

  /** Смена папки по Payload id документа (без доп. запроса). Сущность должна быть в домене. */
  async patchFolder(documentPayloadId: number | string, folderPayloadId: number | string | null): Promise<any> {
    const r = await this.api.patch(`/components/${documentPayloadId}`, { folder: folderPayloadId })
    return r.data
  }

  /** @deprecated Используйте patchFolder(documentPayloadId, folderPayloadId), id берите из домена. */
  async changeFolder(identity: string, folderPayloadId: number | string | null): Promise<any> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return null
    return this.patchFolder((existing as any).id, folderPayloadId)
  }

  /** Мягкое удаление: find по identity, затем PATCH по id документа. */
  async softDelete(identity: string, folderId?: number | string) {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.patch(`/components/${existing.id}`, {
      deletedAt: new Date().toISOString(),
      ...(folderId != null && { folder: folderId }),
    })
  }

  async hardDelete(identity: string) {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.delete(`/components/${existing.id}`)
  }

  async restore(identity: string) {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.patch(`/components/${existing.id}`, { deletedAt: null, folder: null })
  }
}
