// app/repositories/Queries_Repository.ts
import type { AxiosInstance } from 'axios'

export interface QueriesPayloadFields {
  identity: string
  displayName: string
  type?: string
  endpoint?: string
  query?: string
  source?: string
  sourceVersion?: number
  subField?: string
  method?: string
  headers?: any
  timeoutMs?: number
  sendAsFormUrlencoded?: boolean
  params?: any
  returnField?: any
  mockData?: any
  mockDataEnabled?: boolean
  auth?: any
  filterMode?: string
  filters?: any
  author?: string
  active?: boolean
  meta?: Record<string, unknown>
  inherited?: boolean
}

export class Queries_Repository {
  constructor(private api: AxiosInstance) {}

  /** Найти один запрос по identity */
  async findByIdentity(identity: string) {
    const r = await this.api.get('/queries', {
      params: { 'where[identity][equals]': identity, limit: 1 },
    })
    return r.data.docs?.[0] ?? null
  }

  /** Получить все запросы */
  async findAll(params: Record<string, any> = {}) {
    const r = await this.api.get('/queries', {
      params: {
        limit: 0,
        sort: 'identity',
        ...params,
      },
    })
    return r.data.docs ?? []
  }

  async create(data: QueriesPayloadFields) {
    const r = await this.api.post('/queries', { ...data, meta: data.meta ?? {} })
    return r.data
  }

  /** PATCH по id документа (Payload в URL ожидает id, не identity). */
  async update(id: number | string, data: Partial<QueriesPayloadFields>) {
    const r = await this.api.patch(`/queries/${id}`, data)
    return r.data
  }

  async upsert(data: QueriesPayloadFields) {
    const existing = await this.findByIdentity(data.identity)
    if (!existing) return this.create(data)
    return this.update(existing.id, data)
  }

  /** Смена папки по Payload id (без доп. запроса). */
  async patchFolder(documentPayloadId: number | string, folderPayloadId: number | string | null): Promise<any> {
    const r = await this.api.patch(`/queries/${documentPayloadId}`, { folder: folderPayloadId })
    return r.data
  }

  async changeFolder(identity: string, folderPayloadId: number | string | null): Promise<any> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return null
    return this.patchFolder((existing as any).id, folderPayloadId)
  }

  /** Мягкое удаление: find по identity, затем PATCH по id документа. folder - id папки «soft-deleted» в Payload. */
  async softDelete(identity: string, folderId?: number | string) {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.patch(`/queries/${existing.id}`, {
      deletedAt: new Date().toISOString(),
      ...(folderId != null && { folder: folderId }),
    })
  }

  /** Жёсткое удаление документа из Payload (DELETE). */
  async hardDelete(identity: string) {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.delete(`/queries/${existing.id}`)
  }

  /** Восстановление: сброс deletedAt и folder (перенос в корень секции). */
  async restore(identity: string) {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.patch(`/queries/${existing.id}`, { deletedAt: null, folder: null })
  }
}
