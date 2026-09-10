import type { ProgramArtifact, ProgramEntityType, QueryProgramPayload } from '@/features/core/modules/program/domain/types/program.types'
import type { SimulationGenerator } from '@/features/core/modules/runtime/domain/simulation-runtime.types'
import type { CompositionRuntimeHost } from '@/features/core/modules/runtime/hosts/CompositionRuntimeHost'
import type { QueryRuntimeHost } from '@/features/core/modules/runtime/hosts/QueryRuntimeHost'
import type { CompositionProgramPayload } from '@/features/core/modules/source/domain/types/composition-source.types'
import type { SimulationSourceArtifact } from '@/features/core/modules/source/domain/types/simulation-source.types'
import type { TypeProgramPayload } from '@/features/core/modules/source/domain/types/type-source.types'

import { Raph } from '@endge/raph'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { RComposition } from '@/features/core/modules/domain/entities/RComposition'
import { RProject } from '@/features/core/modules/domain/entities/RProject'
import { RQuery } from '@/features/core/modules/domain/entities/RQuery'
import { RSimulation } from '@/features/core/modules/domain/entities/RSimulation'

const generator: SimulationGenerator = {
  generate: async schema => Array.from({ length: Number(schema.minItems) }, (_, index) => `fixture-${index}`),
  openStream: () => {
    throw new Error('No stream in this fixture')
  },
}
const request = (count: number) => ({ kind: 'mock-request' as const, seed: 'fixed', arrays: { '': count } })

describe('simulation runtime isolation and lifecycle', () => {
  afterEach(async () => {
    await Endge.runtime.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Raph.app.reset()
    vi.restoreAllMocks()
  })

  it.each(['composition', 'project'] as const)('owns a %s target, overrides each occurrence, and disposes all children', async (kind) => {
    setup(kind)
    const transport = vi.spyOn(Endge.runtime.query, 'executeArtifact').mockResolvedValue(['network'])
    const session = await Endge.runtime.simulation.mount('scenario', { generator })
    const root = session.host.target!
    expect(root.parent).toBe(session.host)
    const first = await root.getRuntimeHandle('first')!.activate() as CompositionRuntimeHost
    const second = await root.getRuntimeHandle('second')!.activate() as CompositionRuntimeHost
    const a = first.getChild('load') as QueryRuntimeHost
    const b = second.getChild('load') as QueryRuntimeHost
    await a.run()
    await b.run()
    expect(a.getOutput('rows')).toHaveLength(2)
    expect(b.getOutput('rows')).toHaveLength(4)
    expect(transport).not.toHaveBeenCalled()
    const rows = a.getOutput('rows') as unknown[]
    const snapshot = [...rows]
    rows.push('mutated')
    await a.run()
    expect(a.getOutput('rows')).toEqual(snapshot)
    expect(a.meta.persistence).toBe('disabled')
    await session.pause()
    expect(root.getScope('scope_default')?.state).toBe('paused')
    await session.resume()
    expect(root.getScope('scope_default')?.state).toBe('active')
    await session.host.deactivateTarget()
    expect(session.host.target).toBeNull()
    expect(Endge.runtime.getRuntimeHosts()).toHaveLength(1)
    const restarted = await session.host.activateTarget()
    expect(restarted.id).not.toBe(root.id)
    await Promise.all([session.unmount(), session.unmount()])
    expect(Endge.runtime.getRuntimeHosts()).toEqual([])
  })

  it('applies explicit live and forced mock precedence without suppressing an override', async () => {
    setup('composition', 'live')
    const transport = vi.spyOn(Endge.runtime.query, 'executeArtifact').mockResolvedValue(['network'])
    const live = await Endge.runtime.simulation.mount('scenario', { generator })
    const liveQuery = live.host.target!.getChild('uncovered') as QueryRuntimeHost
    expect(Endge.runtime.resolveDataMode(liveQuery)).toBe('live')
    await liveQuery.run()
    expect(liveQuery.getOutput('rows')).toEqual(['network'])
    await live.unmount()
    transport.mockClear()
    const forced = await Endge.runtime.simulation.mount('scenario', { forceMock: true, generator })
    const uncovered = forced.host.target!.getChild('uncovered') as QueryRuntimeHost
    expect(Endge.runtime.resolveDataMode(uncovered)).toBe('mock')
    await uncovered.run()
    const nested = await forced.host.target!.getRuntimeHandle('first')!.activate() as CompositionRuntimeHost
    const covered = nested.getChild('load') as QueryRuntimeHost
    await covered.run()
    expect(covered.getOutput('rows')).toHaveLength(2)
    expect(transport).not.toHaveBeenCalled()
    await forced.unmount()
  })

  it('keeps the running simulation policy when a new artifact is published', async () => {
    setup('composition')
    const transport = vi.spyOn(Endge.runtime.query, 'executeArtifact').mockResolvedValue(['network'])
    const session = await Endge.runtime.simulation.mount('scenario', { generator })
    const original = Endge.program.getArtifact<SimulationSourceArtifact>('simulation', 'scenario')!
    Endge.program.addArtifact({ ...original, payload: { ...original.payload, dataMode: 'live' as const } })
    const query = session.host.target!.getChild('uncovered') as QueryRuntimeHost
    expect(Endge.runtime.resolveDataMode(query)).toBe('mock')
    await query.run()
    expect(transport).not.toHaveBeenCalled()
    await session.unmount()
    const restarted = await Endge.runtime.simulation.mount('scenario', { generator })
    expect(Endge.runtime.resolveDataMode(restarted.host.target!.getChild('uncovered'))).toBe('live')
    await restarted.unmount()
  })

  it('aborts pending service generation during runtime reset', async () => {
    setup('composition')
    let began!: () => void
    const ready = new Promise<void>((resolve) => {
      began = resolve
    })
    const pendingGenerator: SimulationGenerator = {
      ...generator,
      generate: (_schema, _seed, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Generation cancelled', 'AbortError')), { once: true })
        began()
      }),
    }
    const mounting = Endge.runtime.simulation.mount('scenario', { generator: pendingGenerator })
    const rejected = expect(mounting).rejects.toThrow('Generation cancelled')
    await ready
    await Endge.runtime.reset()
    await rejected
    expect(Endge.runtime.getRuntimeHosts()).toEqual([])
  })

  it('rejects a stale override before allocating hosts', async () => {
    setup('composition')
    const artifact = Endge.program.getArtifact<SimulationSourceArtifact>('simulation', 'scenario')!
    artifact.payload.runtimes = [{ alias: 'missing', request: request(2) }]
    await expect(Endge.runtime.simulation.mount('scenario', { generator })).rejects.toThrow('missing')
    expect(Endge.runtime.getRuntimeHosts()).toEqual([])
  })

  it('cancels target activation and releases the graph during runtime reset', async () => {
    setup('composition')
    const session = await Endge.runtime.simulation.mount('scenario', { generator })
    await session.host.deactivateTarget()
    const activation = session.host.activateTarget()
    const rejection = expect(activation).rejects.toThrow('отменена')
    await Endge.runtime.reset()
    await rejection
    expect(Endge.runtime.getRuntimeHosts()).toEqual([])
  })
})

function setup(kind: 'project' | 'composition', dataMode: 'live' | 'mock' = 'mock'): void {
  const query = Object.assign(new RQuery(), { id: 710, identity: 'load', name: 'load' })
  Endge.domain.addQuery(query)
  Endge.program.addArtifact(base<QueryProgramPayload>('query', query.id, query.identity, {
    type: 'query-rest',
    sourceVersion: 2,
    endpoint: '',
    query: '',
    requestBody: null,
    props: [],
    outputs: [{ key: 'rows', source: { type: 'response', path: null }, contract: { key: 'rows', type: 'String', array: true, optional: false }, dataViews: [], materialization: { kind: 'source' } }],
  }))
  Endge.program.addArtifact(base<TypeProgramPayload>('type', 711, 'String', {
    type: 'type',
    sourceVersion: 1,
    category: 'primitive',
    definition: null,
    runtimeType: 'String',
  }))
  const nested = Object.assign(new RComposition(), { id: 712, identity: 'nested', name: 'nested' })
  Endge.domain.addComposition(nested)
  Endge.program.addArtifact(base('composition', nested.id, nested.identity, graph([runtime('load', 'query', 'load')], 'live')))
  const payload = graph([
    runtime('first', 'composition', 'nested', true),
    runtime('second', 'composition', 'nested', true),
    runtime('uncovered', 'query', 'load'),
  ], 'mock')
  if (kind === 'project') {
    const project = Object.assign(new RProject(), { id: 713, identity: 'target', name: 'target' })
    Endge.domain.addProject(project)
    Endge.program.addArtifact(base('project', project.id, project.identity, payload))
  }
  else {
    const composition = Object.assign(new RComposition(), { id: 713, identity: 'target', name: 'target' })
    Endge.domain.addComposition(composition)
    Endge.program.addArtifact(base('composition', composition.id, composition.identity, payload))
  }
  const simulation = Object.assign(new RSimulation(), { id: 714, identity: 'scenario', name: 'scenario' })
  Endge.domain.addSimulation(simulation)
  Endge.program.addArtifact(base<SimulationSourceArtifact>('simulation', simulation.id, simulation.identity, {
    type: 'simulation',
    sourceVersion: 1,
    target: { entityType: kind, identity: 'target' },
    dataMode,
    runtimes: [
      { alias: 'first', runtimes: [{ alias: 'load', request: request(2) }] },
      { alias: 'second', runtimes: [{ alias: 'load', request: request(4) }] },
    ],
  }))
}

function runtime(name: string, kind: 'query' | 'composition', identity: string, manual = false): CompositionProgramPayload['runtimes'][number] {
  const mode = manual ? 'manual' : 'startup'
  return { name, path: name, scopePath: 'scope_default', kind, identity, activationOverride: { mode }, effectiveActivation: { mode }, props: {}, storeTo: [] }
}

function graph(runtimes: CompositionProgramPayload['runtimes'], dataMode: 'live' | 'mock'): CompositionProgramPayload {
  return {
    type: 'composition',
    sourceVersion: 1,
    activation: { mode: 'startup' },
    dataMode,
    props: [],
    data: [],
    resources: [],
    runtimes,
    hooks: [],
    outputs: [],
    scopes: [{ name: 'scope_default', path: 'scope_default', parentPath: null, activationOverride: { mode: 'startup' }, effectiveActivation: { mode: 'startup' }, resources: [], runtimes: runtimes.map(item => item.path), children: [], sourceOrder: 0 }],
    graph: { inputs: [], dataInputs: [], updates: [], publications: [], mounts: [] },
  }
}

function base<T>(entityType: ProgramEntityType, id: string | number, identity: string, payload: T): ProgramArtifact<T> {
  return { ref: { entityType, id, identity }, sourceHash: `test:${identity}`, compilerVersion: 'test', contextHash: 'test', status: 'valid', diagnostics: [], dependencies: [], capabilities: ['compilable', 'executable'], metadata: { self: {}, nodes: [] }, payload }
}
