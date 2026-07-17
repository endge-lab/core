import type { AxiosInstance } from 'axios'

/** Поля проекта для создания/обновления (совпадают с коллекцией Payload). */
export type ProjectPayloadData = {
  identity: string
  displayName: string
  description?: string | null
  slug?: string | null
  order?: number | null
  navigation?: number | null
  allowedEnvironments?: Array<number | string>
  folder?: number | string | null
  deletedAt?: string | null
  configuration?: import('@/domain/types/configuration').EndgeConfigurationContribution
}

export class Projects_Repository {
  constructor(private readonly api: AxiosInstance) {}

  /** найти по identity */
  async findByIdentity(identity: string) {
    const r = await this.api.get('/projects', {
      params: { 'where[identity][equals]': identity, limit: 1 },
    })
    return r.data.docs?.[0] ?? null
  }

  /** получить все проекты (если нужно) */
  async findAll(params: Record<string, any> = {}) {
    const r = await this.api.get('/projects', {
      params: {
        limit: 0,
        sort: 'identity',
        ...params,
      },
    })
    return r.data.docs ?? []
  }

  /** создать запись */
  async create(data: ProjectPayloadData) {
    const payload: Record<string, unknown> = {
      identity: data.identity,
      displayName: data.displayName,
    }
    if (data.description != null) payload.description = data.description
    if (data.slug != null) payload.slug = data.slug
    if (data.order != null) payload.order = data.order
    if (data.navigation != null) payload.navigation = data.navigation
    if (data.allowedEnvironments !== undefined) payload.allowedEnvironments = data.allowedEnvironments
    if (data.folder !== undefined) payload.folder = data.folder
    if (data.deletedAt !== undefined) payload.deletedAt = data.deletedAt
    if (data.configuration !== undefined) payload.configuration = data.configuration
    const r = await this.api.post('/projects', payload)
    return r.data
  }

  /** PATCH по id документа (Payload в URL ожидает id, не identity). */
  async update(id: number | string, data: Partial<ProjectPayloadData>) {
    const r = await this.api.patch(`/projects/${id}`, data)
    return r.data
  }

  /** Только смена папки: PATCH с полем folder. Возвращает обновлённый документ. */
  async patchFolder(documentPayloadId: number | string, folderPayloadId: number | string | null): Promise<any> {
    const r = await this.api.patch(`/projects/${documentPayloadId}`, { folder: folderPayloadId })
    return r.data
  }

  async changeFolder(identity: string, folderPayloadId: number | string | null): Promise<any> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return null
    return this.patchFolder((existing as any).id, folderPayloadId)
  }

  /** создать или обновить по identity */
  async upsert(data: ProjectPayloadData) {
    const existing = await this.findByIdentity(data.identity)
    if (!existing) return this.create(data)
    return this.update(existing.id, data)
  }

  /** Мягкое удаление: find по identity, затем PATCH по id документа. */
  async softDelete(identity: string, folderId?: number | string | null) {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    const data: Record<string, unknown> = {
      deletedAt: new Date().toISOString(),
    }
    if (folderId !== undefined)
      data.folder = folderId
    await this.api.patch(`/projects/${existing.id}`, data)
  }

  /** Восстановление: сброс deletedAt у записи проекта. */
  async restore(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.patch(`/projects/${existing.id}`, {
      deletedAt: null,
      folder: null,
    })
  }

  /** Жёсткое удаление проекта через DELETE. */
  async hardDelete(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return
    await this.api.delete(`/projects/${existing.id}`)
  }
}
