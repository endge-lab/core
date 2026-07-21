import { describe, expect, it, vi } from 'vitest'

import { RType } from '@/domain/entities/reflect/RType'
import { Endge } from '@/model/endge/kernel/endge'
import { EndgeSchemaStorage } from '@/model/endge/schema/endge-schema-database'

describe('type Payload persistence', () => {
  it('uses the last persisted identity when saving a renamed type', async () => {
    const type = new RType('Renamed type')
    type.identity = 'renamed-type'
    const upsert = vi.fn(async (payload: Record<string, unknown>) => payload)
    const storage = new EndgeSchemaStorage()

    vi.spyOn(Endge, 'domain', 'get').mockReturnValue({} as any)
    storage.repositories = { types: { upsert } } as any
    ;(storage as any)._applyPayloadDocToDomain = vi.fn()

    await storage.saveDocument('Renamed type', 'type', {
      model: type,
      previousIdentity: 'original-type',
    })

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      identity: 'renamed-type',
      displayName: 'Renamed type',
    }), 'original-type')
  })
})
