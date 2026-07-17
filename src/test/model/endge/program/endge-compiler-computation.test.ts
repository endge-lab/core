import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RComputation } from '@/domain/entities/reflect/RComputation'
import { REnvironment } from '@/domain/entities/reflect/REnvironment'
import { RProject } from '@/domain/entities/reflect/RProject'
import { RTenant } from '@/domain/entities/reflect/RTenant'
import { Endge } from '@/model/endge/kernel/endge'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('EndgeCompiler computation dependencies', () => {
  beforeEach(() => prepareCompilerContext())

  afterEach(() => {
    Endge.runtime.computation.setSandboxAdapter(null)
    Endge.configuration.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Endge.workspace.reset()
  })

  it('links and executes a sync external computation inside a value-expression chain', () => {
    Endge.domain.addComputation(computation(1, 'shared.normalize', `defineComputation({
      outputs: {
        result: { label: input('value').trim() },
      },
      result: output('result'),
    })`))
    Endge.domain.addComputation(computation(2, 'feature.label', `defineComputation({
      outputs: {
        label: computation('shared.normalize', {
          value: input('name'),
        }).get('label').upperCase(),
      },
      result: output('label'),
    })`))

    Endge.compiler.build({} as any)

    const artifact = Endge.program.getComputationArtifact('feature.label')
    expect(artifact?.status).toBe('valid')
    expect(artifact?.payload.execution).toBe('sync')
    expect(artifact?.dependencies).toEqual([
      expect.objectContaining({
        entityType: 'computation',
        identity: 'shared.normalize',
        role: 'computation-call',
      }),
    ])
    expect(Endge.runtime.computation.runSync('feature.label', { name: '  endge  ' })).toBe('ENDGE')
  })

  it('propagates async execution through external computation calls', async () => {
    Endge.domain.addComputation(computation(1, 'shared.double', `defineComputation({
      outputs: {
        result: typescript({
          inputs: { value: input('value') },
          compute({ value }) { return value * 2 },
        }),
      },
      result: output('result'),
    })`))
    Endge.domain.addComputation(computation(2, 'feature.total', `defineComputation({
      outputs: {
        total: sum([computation('shared.double', { value: input('value') }), 1]),
      },
      result: output('total'),
    })`))
    Endge.runtime.computation.setSandboxAdapter({
      execute: async request => Number(request.inputs.value) * 2,
    })

    Endge.compiler.build({} as any)

    expect(Endge.program.getComputationArtifact('feature.total')?.payload.execution).toBe('async')
    await expect(Endge.runtime.computation.run('feature.total', { value: 5 })).resolves.toBe(11)
    expect(() => Endge.runtime.computation.runSync('feature.total', { value: 5 })).toThrow('requires asynchronous')
  })

  it('rejects missing references and indirect computation cycles during linking', () => {
    Endge.domain.addComputation(computation(1, 'cycle.a', sourceCalling('cycle.b')))
    Endge.domain.addComputation(computation(2, 'cycle.b', sourceCalling('cycle.c')))
    Endge.domain.addComputation(computation(3, 'cycle.c', sourceCalling('cycle.a')))
    Endge.domain.addComputation(computation(4, 'missing.owner', sourceCalling('missing.target')))

    Endge.compiler.build({} as any)

    for (const identity of ['cycle.a', 'cycle.b', 'cycle.c']) {
      const artifact = Endge.program.getComputationArtifact(identity)
      expect(artifact?.status).toBe('error')
      expect(artifact?.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'computation-reference-cycle',
          message: expect.stringContaining('cycle.a'),
        }),
      ]))
      expect(() => Endge.runtime.computation.runSync(identity, {})).toThrow('contains compile errors')
    }

    expect(Endge.program.getComputationArtifact('missing.owner')).toEqual(expect.objectContaining({
      status: 'error',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'computation-reference-missing' }),
      ]),
    }))
  })
})

function computation(id: number, identity: string, source: string): RComputation {
  const value = new RComputation()
  value.id = id
  value.identity = identity
  value.name = identity
  value.displayName = identity
  value.source = source
  return value
}

function sourceCalling(identity: string): string {
  return `defineComputation({
    outputs: {
      result: computation('${identity}', input()),
    },
    result: output('result'),
  })`
}

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
