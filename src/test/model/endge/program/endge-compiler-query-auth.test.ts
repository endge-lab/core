import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RAuthProfile } from '@/domain/entities/reflect/RAuthProfile'
import { REnvironment } from '@/domain/entities/reflect/REnvironment'
import { RProject } from '@/domain/entities/reflect/RProject'
import { RQuery } from '@/domain/entities/reflect/RQuery'
import { RTenant } from '@/domain/entities/reflect/RTenant'
import { Endge } from '@/model/endge/kernel/endge'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('EndgeCompiler Query auth dependencies', () => {
  beforeEach(() => prepareCompilerContext())

  afterEach(() => {
    Endge.configuration.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Endge.workspace.reset()
  })

  it('publishes a static auth profile as an explicit Program dependency', () => {
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
  Endge.workspace.apply(TEST_ENDGE_WORKSPACE)
  Endge.domain.addProject(RProject.fromPlain({ id: 101, identity: 'project', name: 'Project' }))
  Endge.domain.addEnvironment(REnvironment.fromPlain({ id: 102, identity: 'environment', name: 'Environment' }))
  const tenant = new RTenant()
  tenant.id = 103
  tenant.identity = 'tenant'
  tenant.name = 'Tenant'
  tenant.code = 'tenant'
  Endge.domain.addTenant(tenant)
  Endge.configuration.build({
    dataProvider: 'plain',
    scope: {},
    vars: {},
    context: { projectIdentity: 'project', environmentIdentity: 'environment', tenantIdentity: 'tenant' },
  })
}
