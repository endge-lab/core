import type { AxiosInstance } from 'axios'

export interface ConverterDoc {
  id: number
  identity: string
  displayName: string
  description?: string | null
  folder?: number | string
  isSystem?: boolean
}

export class Converters_Repository {
  constructor(private readonly api: AxiosInstance) {}

  async findByIdentity(identity: string): Promise<ConverterDoc | null> {
    const r = await this.api.get('/converters', {
      params: {
        limit: 1,
        'where[identity][equals]': identity,
      },
    })
    return r.data?.docs?.[0] ?? null
  }

  async findAll(params: Record<string, any> = {}): Promise<ConverterDoc[]> {
    const r = await this.api.get('/converters', {
      params: {
        limit: 0,
        sort: 'identity',
        depth: 1,
        ...params,
      },
    })
    return r.data?.docs ?? []
  }

  async create(data: {
    identity: string
    displayName: string
    description?: string | null
    folder?: number | string
    isSystem?: boolean
  }): Promise<ConverterDoc> {
    const r = await this.api.post('/converters', data)
    return r.data
  }

  /** PATCH по id документа (Payload в URL ожидает id, не identity). */
  async update(
    id: number | string,
    data: Partial<{
      identity: string
      displayName: string
      description: string | null
      folder: number | string
      isSystem: boolean
    }>,
  ): Promise<ConverterDoc> {
    const r = await this.api.patch(`/converters/${id}`, data)
    return r.data
  }

  /** Только смена папки: PATCH с полем folder. Возвращает обновлённый документ. */
  async patchFolder(documentPayloadId: number | string, folderPayloadId: number | string | null): Promise<any> {
    const r = await this.api.patch(`/converters/${documentPayloadId}`, { folder: folderPayloadId })
    return r.data
  }

  async changeFolder(identity: string, folderPayloadId: number | string | null): Promise<any> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return null
    return this.patchFolder((existing as any).id, folderPayloadId)
  }

  async upsert(data: {
    identity: string
    displayName: string
    description?: string | null
    folder?: number | string
    isSystem?: boolean
  }): Promise<ConverterDoc> {
    const existing = await this.findByIdentity(data.identity)
    if (!existing) return this.create(data)
    return this.update(existing.id, {
      displayName: data.displayName,
      description: data.description ?? null,
      folder: data.folder,
      ...(data.isSystem !== undefined && { isSystem: data.isSystem }),
    })
  }
}
