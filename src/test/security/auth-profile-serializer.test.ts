import { describe, expect, it } from 'vitest'

import { serializeServiceDocument } from '@/model/services/document/endge-service-document-serializer'

describe('authProfile service serializer', () => {
  it('clears token session policy when profile switches to Basic', () => {
    expect(serializeServiceDocument('auth-profile', {
      identity: 'basic',
      displayName: 'Basic',
      adapterId: 'basic',
      config: {},
      credentials: { username: 'test', password: 'literal' },
      session: undefined,
    })).toMatchObject({
      adapterId: 'basic',
      credentials: { username: 'test', password: 'literal' },
      session: null,
    })
  })
})
