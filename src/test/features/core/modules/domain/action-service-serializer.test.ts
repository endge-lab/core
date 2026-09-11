import { describe, expect, it } from 'vitest'

import { serializeServiceDocument } from '@/features/core/modules/domain/documents/service-document-serializer'

describe('action service serializer', () => {
  it('persists canonical Source fields without dropping existing Action fields', () => {
    const result = serializeServiceDocument('action', {
      identity: 'orders.save',
      displayName: 'Save order',
      source: 'defineAction({ steps: { result: input() }, output: output("result") })',
      sourceVersion: 3,
      definition: { legacy: true },
      target: [{ type: 'component.table', identity: 'orders' }],
      meta: { configurator: { pinned: true } },
    }, {
      resolveFolderIdentity: () => null,
      resolveEnvironmentIdentity: () => null,
    })

    expect(result).toMatchObject({
      sourceVersion: 3,
      source: expect.stringContaining('defineAction'),
      definition: { legacy: true },
      target: [{ type: 'component.table', identity: 'orders' }],
      meta: { configurator: { pinned: true } },
    })
  })
})
