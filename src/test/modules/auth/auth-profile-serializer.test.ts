import { describe, expect, it } from 'vitest'

import { serializeServiceDocument } from '@/modules/domain/documents/service-document-serializer'

describe('сериализатор сервиса AuthProfile', () => {
  it('очищает политику token-сессии при переключении профиля на Basic', () => {
    expect(serializeServiceDocument('auth-profile', {
      identity: 'basic',
      displayName: 'Basic',
      adapterId: 'basic',
      config: {},
      credentials: { username: 'test', password: 'literal' },
      session: undefined,
    }, {
      resolveFolderIdentity: value => String(value),
      resolveNavigationIdentity: value => String(value),
      resolveEnvironmentIdentity: value => String(value),
    })).toMatchObject({
      adapterId: 'basic',
      credentials: { username: 'test', password: 'literal' },
      session: null,
    })
  })
})
