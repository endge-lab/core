import type { AxiosInstance } from 'axios'
import type {
  BehaviorBindingDoc,
  BehaviorBindingWriteData,
} from '@/domain/types/configuration/faceted-cascade'

export class BehaviorBindings_Repository {
  constructor(private readonly _api: AxiosInstance) {}

  async findByIdentity(identity: string): Promise<BehaviorBindingDoc | null> {
    const r = await this._api.get('/behavior-bindings', {
      params: {
        limit: 1,
        'where[identity][equals]': identity,
      },
    })
    return r.data?.docs?.[0] ?? null
  }

  async findAll(params: Record<string, unknown> = {}): Promise<BehaviorBindingDoc[]> {
    const r = await this._api.get('/behavior-bindings', {
      params: {
        limit: 0,
        sort: 'identity',
        ...params,
      },
    })
    return r.data?.docs ?? []
  }

  /** Payload ожидает ownerId/targetId как text (строка). */
  private _toPayloadBody(data: BehaviorBindingWriteData | Partial<BehaviorBindingWriteData>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...data }
    if (data.ownerId !== undefined)
      out.ownerId = String(data.ownerId)
    if (data.targetId !== undefined)
      out.targetId = String(data.targetId)
    return out
  }

  async create(data: BehaviorBindingWriteData): Promise<BehaviorBindingDoc> {
    const r = await this._api.post('/behavior-bindings', this._toPayloadBody(data))
    return r.data
  }

  async update(
    id: number,
    data: Partial<BehaviorBindingWriteData>,
  ): Promise<BehaviorBindingDoc> {
    const r = await this._api.patch(`/behavior-bindings/${id}`, this._toPayloadBody(data))
    return r.data
  }

  async patchFolder(documentPayloadId: number | string, folderPayloadId: number | null): Promise<BehaviorBindingDoc | null> {
    const r = await this._api.patch(`/behavior-bindings/${documentPayloadId}`, { folder: folderPayloadId })
    return r.data
  }

  async changeFolder(identity: string, folderPayloadId: number | null): Promise<BehaviorBindingDoc | null> {
    const existing = await this.findByIdentity(identity)
    if (!existing) return null
    return this.patchFolder((existing as any).id, folderPayloadId)
  }

  async hardDelete(identity: string): Promise<void> {
    const existing = await this.findByIdentity(identity)
    if (!existing)
      return
    await this._api.delete(`/behavior-bindings/${existing.id}`)
  }

  async upsert(data: BehaviorBindingWriteData): Promise<BehaviorBindingDoc> {
    const existing = await this.findByIdentity(data.identity)
    if (!existing)
      return this.create(data)
    return this.update(existing.id, {
      displayName: data.displayName,
      projectId: data.projectId ?? null,
      ownerType: data.ownerType,
      ownerId: data.ownerId,
      targetType: data.targetType,
      targetId: data.targetId,
      eventName: data.eventName,
      scriptRef: data.scriptRef,
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
