import { describe, expect, it, vi } from 'vitest'

import { RComputation } from '@/domain/entities/reflect/RComputation'
import { Endge } from '@/model/endge/kernel/endge'
import { EndgeSchemaStorage } from '@/model/endge/schema/endge-schema-database'

describe('computation Payload persistence', () => {
  it('creates and sends the computations root folder when a draft has no folder', async () => {
    const computation = RComputation.fromPlain({
      identity: 'test-computation',
      displayName: 'Test computation',
      source: `defineComputation({
  outputs: { value: input('value') },
  result: output('value'),
})`,
    })
    const upsert = vi.fn(async (payload: Record<string, unknown>) => payload)
    const createFolder = vi.fn(async () => ({ id: 42 }))
    const storage = new EndgeSchemaStorage()

    vi.spyOn(Endge, 'domain', 'get').mockReturnValue({} as any)
    storage.repositories = {
      computations: {
        findByIdentity: vi.fn(async () => null),
        upsert,
      },
      folders: {
        findByIdentity: vi.fn(async () => null),
        create: createFolder,
      },
    } as any
    ;(storage as any)._applyPayloadDocToDomain = vi.fn()

    await storage.saveDocument(computation.identity, 'computation', { model: computation })

    expect(createFolder).toHaveBeenCalledWith({
      identity: 'root-computations',
      displayName: 'Вычисления',
      entityType: 'computations',
    })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      identity: computation.identity,
      folder: 42,
      source: computation.source,
      input: {},
      output: {},
    }))
    expect(upsert.mock.calls[0]?.[0]).not.toHaveProperty('implementationKind')
    expect(upsert.mock.calls[0]?.[0]).not.toHaveProperty('sourceLanguage')
    expect(upsert.mock.calls[0]?.[0]).not.toHaveProperty('providerRef')
  })
})
