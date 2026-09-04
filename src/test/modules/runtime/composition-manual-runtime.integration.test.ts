import type { ProgramArtifact, QueryProgramPayload } from '@/modules/program/domain/types/program.types'
import type { QueryRuntimeHost } from '@/modules/runtime/hosts/QueryRuntimeHost'

import type { CompositionProgramPayload } from '@/modules/source/domain/types/composition-source.types'
import { Raph } from '@endge/raph'
import { afterEach, describe, expect, it } from 'vitest'
import { Endge } from '@/kernel/endge'
import { RComposition } from '@/modules/domain/entities/RComposition'
import { RQuery } from '@/modules/domain/entities/RQuery'

describe('проверка Handle ручного runtime Composition', () => {
  afterEach(async () => {
    await Endge.runtime.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Raph.app.reset()
  })

  it('оставляет fromOutput неопределённым до активации и затем повторно подключает стабильный bridge', async () => {
    const source = query(601, 'manual-source')
    const consumer = query(602, 'consumer')
    const composition = new RComposition()
    composition.id = 603
    composition.identity = 'manual-graph'
    composition.name = 'Manual graph'
    Endge.domain.addQuery(source)
    Endge.domain.addQuery(consumer)
    Endge.domain.addComposition(composition)
    Endge.program.addArtifact(queryArtifact(source, true))
    Endge.program.addArtifact(queryArtifact(consumer, false))
    Endge.program.addArtifact(compositionArtifact(composition))

    const session = await Endge.runtime.composition.mount('manual-graph')
    const consumerHost = session.host.getChild('consumer') as QueryRuntimeHost
    const sourceHandle = session.host.getRuntimeHandle('source')!
    expect(sourceHandle.runtime).toBeNull()
    expect(consumerHost.getProps().rows).toBeUndefined()

    const sourceHost = await sourceHandle.activate() as QueryRuntimeHost
    Raph.set(sourceHost.outputPath('rows'), [{ id: 1 }])
    expect(consumerHost.getProps().rows).toEqual([{ id: 1 }])
    expect(sourceHandle.getOutput('rows')).toEqual([{ id: 1 }])

    await sourceHandle.deactivate()
    expect(sourceHandle.runtime).toBeNull()
    expect(consumerHost.getProps().rows).toBeUndefined()
    await session.unmount()
  })
})

function query(id: number, identity: string): RQuery {
  const value = new RQuery()
  value.id = id
  value.identity = identity
  value.name = identity
  return value
}

function queryArtifact(model: RQuery, hasOutput: boolean): ProgramArtifact<QueryProgramPayload> {
  return baseArtifact('query', model.id, model.identity, {
    type: 'query-rest',
    sourceVersion: 2,
    endpoint: '',
    query: '',
    requestBody: null,
    props: hasOutput ? [] : [{ key: 'rows', type: 'Object', optional: true, array: true }],
    outputs: hasOutput
      ? [{ key: 'rows', source: { type: 'response', path: null }, dataViews: [], materialization: { kind: 'source' } }]
      : [],
  })
}

function compositionArtifact(model: RComposition): ProgramArtifact<CompositionProgramPayload> {
  const runtimes: CompositionProgramPayload['runtimes'] = [
    {
      name: 'source',
      path: 'source',
      scopePath: 'scope_default',
      kind: 'query',
      identity: 'manual-source',
      activationOverride: { mode: 'manual' },
      effectiveActivation: { mode: 'manual' },
      props: {},
      storeTo: [],
    },
    {
      name: 'consumer',
      path: 'consumer',
      scopePath: 'scope_default',
      kind: 'query',
      identity: 'consumer',
      activationOverride: { mode: 'startup' },
      effectiveActivation: { mode: 'startup' },
      props: { rows: { kind: 'output', runtime: 'source', output: 'rows' } },
      storeTo: [],
    },
  ]
  return baseArtifact('composition', model.id, model.identity, {
    type: 'composition',
    sourceVersion: 1,
    activation: { mode: 'startup' },
    props: [],
    data: [],
    resources: [],
    runtimes,
    hooks: [],
    outputs: [],
    scopes: [{
      name: 'scope_default',
      path: 'scope_default',
      parentPath: null,
      activationOverride: { mode: 'startup' },
      effectiveActivation: { mode: 'startup' },
      resources: [],
      runtimes: ['source', 'consumer'],
      children: [],
      sourceOrder: 0,
    }],
    graph: {
      inputs: [{ targetRuntime: 'consumer', targetProp: 'rows', source: { kind: 'output', runtime: 'source', output: 'rows' } }],
      dataInputs: [],
      updates: [],
      publications: [],
      mounts: [],
    },
  })
}

function baseArtifact<T>(entityType: 'query' | 'composition', id: number, identity: string, payload: T): ProgramArtifact<T> {
  return {
    ref: { entityType, id, identity },
    sourceHash: `test:${identity}`,
    compilerVersion: 'test',
    contextHash: 'test',
    status: 'valid',
    diagnostics: [],
    dependencies: [],
    capabilities: ['compilable', 'executable'],
    metadata: { self: {}, nodes: [] },
    payload,
  }
}
