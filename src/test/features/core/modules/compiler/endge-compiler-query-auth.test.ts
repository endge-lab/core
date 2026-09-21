import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'
import { RAuthProfile } from '@/features/core/modules/domain/entities/RAuthProfile'
import { RQuery } from '@/features/core/modules/domain/entities/RQuery'
import { prepareTestCompilerContext } from '@/test/helpers/compiler-context'

describe('зависимости авторизации Query в EndgeCompiler', () => {
  beforeEach(() => prepareCompilerContext())

  afterEach(() => {
    Endge.configuration.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Endge.workspace.reset()
  })

  it('публикует статический профиль авторизации как явную зависимость Program', () => {
    const profile = new RAuthProfile()
    profile.id = 41
    profile.identity = 'payload-auth'
    profile.name = 'Payload auth'
    Endge.domain.addAuthProfile(profile)

    const query = new RQuery()
    query.id = 42
    query.identity = 'flights'
    query.name = 'Flights'
    query.source = `defineQuery({
      kind: 'rest',
      request: {
        endpoint: '',
        path: '/flights',
        method: 'GET',
        headers: {},
        auth: { mode: 'profile', profile: 'payload-auth' },
      },
      outputs: { raw: output().from(response('items')) },
      mock: { enabled: false, data: null },
    })`

    const artifact = Endge.compiler.buildQuery(query)

    expect(artifact.dependencies).toContainEqual({
      entityType: 'auth-profile',
      id: profile.id,
      identity: profile.identity,
      role: 'query-auth',
    })
  })
})

function prepareCompilerContext(): void {
  prepareTestCompilerContext()
}
