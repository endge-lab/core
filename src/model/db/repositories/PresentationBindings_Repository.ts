import type { AxiosInstance } from 'axios'
import type {
  PresentationBindingDoc,
  PresentationBindingWriteData,
} from '@/domain/types/configuration/faceted-cascade'

export class PresentationBindings_Repository {
  constructor(private readonly _api: AxiosInstance) {}

  async findByIdentity(identity: string): Promise<PresentationBindingDoc | null> {
    const r = await this._api.get('/presentation-bindings', {
      params: {
        limit: 1,
        'where[identity][equals]': identity,
      },
    })
    return r.data?.docs?.[0] ?? null
  }

  async findAll(params: Record<string, unknown> = {}): Promise<PresentationBindingDoc[]> {
    const r = await this._api.get('/presentation-bindings', {
      params: {
        limit: 0,
        sort: 'identity',
        ...params,
      },
    })
    return r.data?.docs ?? []
  }

  async create(data: PresentationBindingWriteData): Promise<PresentationBindingDoc> {
    const r = await this._api.post('/presentation-bindings', data)
    return r.data
  }

  async update(
    id: number,
    data: Partial<PresentationBindingWriteData>,
  ): Promise<PresentationBindingDoc> {
    const r = await this._api.patch(`/presentation-bindings/${id}`, data)
    return r.data
  }

  async patchFolder(documentPayloadId: number | string, folderPayloadId: number | null): Promise<PresentationBindingDoc | null> {
    const r = await this._api.patch(`/presentation-bindings/${documentPayloadId}`, { folder: folderPayloadId })
    return r.data
  }

  async changeFolder(identity: string, folderPayloadId: number | null): Promise<PresentationBindingDoc | null> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return null
    return this.patchFolder((existing as any).id, folderPayloadId)
  }

  async hardDelete(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (!existing)
      return
    await this._api.delete(`/presentation-bindings/${existing.id}`)
  }

  async upsert(data: PresentationBindingWriteData): Promise<PresentationBindingDoc> {
    const existing = await this.findByIdentity(data.identity)
    if (!existing)
      return this.create(data)
    return this.update(existing.id, {
      displayName: data.displayName,
      projectId: data.projectId ?? null,
      ownerType: data.ownerType,
      ownerId: data.ownerId,
      targetType: data.targetType,
      targetId: data.targetId ?? null,
      role: data.role,
      rendererRef: data.rendererRef,
      when: data.when ?? null,
      mode: data.mode,
      priority: data.priority,
      isEnabled: data.isEnabled === true,
      environmentId: data.environmentId ?? null,
      isInherited: data.isInherited === true,
      originBindingId: data.originBindingId ?? null,
      folder: data.folder ?? null,
    })
  }
}
