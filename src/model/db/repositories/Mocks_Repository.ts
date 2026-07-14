import type { AxiosInstance } from 'axios'

import type { RMockContentSource, RMockContentType } from '@/domain/types/mock'

export interface MocksPayloadFields {
  identity: string
  displayName: string
  description?: string | null
  contentSource: RMockContentSource
  contentType: RMockContentType
  source?: string
  codeRef?: string | null
  folder?: string | number | null
  project?: string | number | null
  meta?: Record<string, unknown>
  author?: string | null
  active?: boolean
  deletedAt?: string | null
  inherited?: boolean
}

/** Репозиторий Payload-коллекции mocks. */
export class Mocks_Repository {
  public constructor(private readonly api: AxiosInstance) {}

  /** Ищет mock по persisted identity. */
  public async findByIdentity(identity: string) {
    const response = await this.api.get('/mocks', {
      params: { 'where[identity][equals]': identity, limit: 1, depth: 1 },
    })
    return response.data.docs?.[0] ?? null
  }

  /** Загружает все mock-документы. */
  public async findAll(params: Record<string, any> = {}) {
    const response = await this.api.get('/mocks', {
      params: { limit: 0, sort: 'identity', depth: 1, ...params },
    })
    return response.data.docs ?? []
  }

  /** Создает mock-документ. */
  public async create(data: MocksPayloadFields) {
    const response = await this.api.post('/mocks', normalizePayload(data))
    return response.data
  }

  /** Обновляет mock-документ по Payload id. */
  public async update(id: string | number, data: Partial<MocksPayloadFields>) {
    const response = await this.api.patch(`/mocks/${id}`, normalizePayload(data))
    return response.data
  }

  /** Создает или обновляет mock-документ по identity. */
  public async upsert(data: MocksPayloadFields) {
    const existing = await this.findByIdentity(data.identity)
    return existing ? this.update(existing.id, data) : this.create(data)
  }

  /** Перемещает mock-документ в папку. */
  public async patchFolder(id: string | number, folder: string | number | null) {
    const response = await this.api.patch(`/mocks/${id}`, { folder })
    return response.data
  }

  /** Выполняет soft delete mock-документа. */
  public async softDelete(identity: string, folder?: string | number): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (existing) {
      await this.api.patch(`/mocks/${existing.id}`, {
        active: false,
        deletedAt: new Date().toISOString(),
        ...(folder != null && { folder }),
      })
    }
  }

  /** Удаляет mock-документ окончательно. */
  public async hardDelete(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (existing)
      await this.api.delete(`/mocks/${existing.id}`)
  }

  /** Восстанавливает mock-документ в корень секции. */
  public async restore(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (existing)
      await this.api.patch(`/mocks/${existing.id}`, { active: true, deletedAt: null, folder: null })
  }
}

function normalizePayload<T extends Record<string, any>>(data: T): Partial<T> {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as Partial<T>
}
