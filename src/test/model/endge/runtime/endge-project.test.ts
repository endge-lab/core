import { afterEach, describe, expect, it } from 'vitest'

import { RComposition } from '@/domain/entities/reflect/RComposition'
import { RProject } from '@/domain/entities/reflect/RProject'
import type { CompositionProgramPayload } from '@/domain/types/source/composition-source.types'
import type { ProgramArtifact } from '@/domain/types/program/program.types'
import type { RuntimeScopeHandle } from '@/domain/types/runtime/runtime-scope.types'
import { Endge } from '@/model/endge/kernel/endge'

describe('Endge project runtime session', () => {
  afterEach(async () => {
    await Endge.runtime.reset()
    Endge.program.clear()
    Endge.domain.reset()
  })

  it('discovers project compositions and respects startup/manual root activation', async () => {
    const project = RProject.fromPlain({ id: 501, identity: 'airport', name: 'Airport' })
    Endge.domain.addProject(project)
    const startup = composition(502, 'project-startup', 'airport')
    const manual = composition(503, 'project-manual', 'airport')
    const foreign = composition(504, 'foreign-entry', 'another-project')
    Endge.domain.addComposition(startup)
    Endge.domain.addComposition(manual)
    Endge.domain.addComposition(foreign)
    Endge.program.addArtifact(artifact(startup, payload('startup')))
    Endge.program.addArtifact(artifact(manual, payload('manual')))
    Endge.program.addArtifact(artifact(foreign, payload('startup')))

    const session = await Endge.runtime.project.mount('airport')
    expect(session.compositions.getAll().map(item => item.identity)).toEqual(['project-manual', 'project-startup'])
    expect(session.compositions.require('project-startup').state).toBe('active')
    expect(session.compositions.require('project-manual').state).toBe('inactive')
    expect(session.compositions.get('foreign-entry')).toBeNull()

    await session.compositions.require('project-manual').activate()
    expect(session.compositions.require('project-manual').state).toBe('active')
    await session.compositions.require('project-manual').deactivate()
    expect(session.compositions.require('project-manual').state).toBe('inactive')

    await session.unmount()
    expect(Endge.runtime.getRuntimeHosts()).toEqual([])
    expect(Endge.runtime.scopes.getAll().filter(scope => scope.ownerRuntimeId === session.id)).toEqual([])
  })

  it('supports debug mounting without auto activation and reusable pause/resume/restart handles', async () => {
    const project = RProject.fromPlain({ id: 505, identity: 'debug-project', name: 'Debug project' })
    const entry = composition(506, 'debug-entry', 'debug-project')
    Endge.domain.addProject(project)
    Endge.domain.addComposition(entry)
    Endge.program.addArtifact(artifact(entry, payload('startup')))

    const session = await Endge.runtime.project.mount('debug-project', { autoActivate: 'none' })
    const handle = session.compositions.require('debug-entry')
    expect(handle.state).toBe('inactive')
    expect(handle.host).toBeNull()

    const first = await handle.activate()
    expect(handle.state).toBe('active')
    await handle.pause()
    expect(handle.state).toBe('paused')
    await handle.resume()
    expect(handle.state).toBe('active')

    const restarted = await handle.restart()
    expect(restarted.id).not.toBe(first.id)
    expect(handle.state).toBe('active')

    await handle.deactivate()
    expect(handle.state).toBe('inactive')
    expect(handle.host).toBeNull()
    await session.unmount()
    expect(Endge.runtime.getRuntimeHosts()).toEqual([])
  })

  it('switches named scopes atomically and rejects handles from another project session', async () => {
    const project = RProject.fromPlain({ id: 510, identity: 'airport', name: 'Airport' })
    const entry = composition(511, 'project-entry', 'airport')
    Endge.domain.addProject(project)
    Endge.domain.addComposition(entry)
    Endge.program.addArtifact(artifact(entry, payloadWithPages()))

    const firstSession = await Endge.runtime.project.mount('airport')
    const firstEntry = firstSession.compositions.require('project-entry')
    const pageA = firstEntry.output<RuntimeScopeHandle>('pageA')!
    const pageB = firstEntry.output<RuntimeScopeHandle>('pageB')!
    await pageA.activate()

    await firstSession.switchScope({ from: pageA, to: pageB, previous: 'pause' })
    expect(pageA.state).toBe('paused')
    expect(pageB.state).toBe('active')

    await firstSession.switchScope({ from: pageB, to: pageA, previous: 'deactivate' })
    expect(pageA.state).toBe('active')
    expect(pageB.state).toBe('inactive')

    const secondSession = await Endge.runtime.project.mount('airport')
    const foreignPage = secondSession.compositions
      .require('project-entry')
      .output<RuntimeScopeHandle>('pageA')!
    await expect(firstSession.switchScope({ to: foreignPage })).rejects.toThrow('another or disposed session')

    await secondSession.unmount()
    await firstSession.unmount()
    expect(Endge.runtime.getRuntimeHosts()).toEqual([])
  })
})

function composition(id: number, identity: string, project: string): RComposition {
  const value = new RComposition()
  value.id = id
  value.identity = identity
  value.name = identity
  value.kind = 'project'
  value.kindIdentity = project
  return value
}

function payload(mode: 'startup' | 'manual'): CompositionProgramPayload {
  return {
    type: 'composition', sourceVersion: 1, activation: { mode }, props: [], data: [], resources: [], runtimes: [], hooks: [], outputs: [],
    scopes: [{
      name: 'scope_default', path: 'scope_default', parentPath: null,
      activationOverride: { mode }, effectiveActivation: { mode },
      resources: [], runtimes: [], children: [], sourceOrder: 0,
    }],
    graph: { inputs: [], dataInputs: [], updates: [], publications: [], mounts: [] },
  }
}

function payloadWithPages(): CompositionProgramPayload {
  return {
    type: 'composition', sourceVersion: 1, activation: { mode: 'startup' }, props: [], data: [], resources: [], runtimes: [], hooks: [],
    scopes: [
      {
        name: 'scope_default', path: 'scope_default', parentPath: null,
        activationOverride: { mode: 'startup' }, effectiveActivation: { mode: 'startup' },
        resources: [], runtimes: [], children: ['pageA', 'pageB'], sourceOrder: 0,
      },
      {
        name: 'pageA', path: 'pageA', parentPath: 'scope_default',
        activationOverride: { mode: 'manual' }, effectiveActivation: { mode: 'manual' },
        resources: [], runtimes: [], children: [], sourceOrder: 1,
      },
      {
        name: 'pageB', path: 'pageB', parentPath: 'scope_default',
        activationOverride: { mode: 'manual' }, effectiveActivation: { mode: 'manual' },
        resources: [], runtimes: [], children: [], sourceOrder: 2,
      },
    ],
    outputs: [
      { key: 'pageA', kind: 'scope', scope: 'pageA' },
      { key: 'pageB', kind: 'scope', scope: 'pageB' },
    ],
    graph: { inputs: [], dataInputs: [], updates: [], publications: [], mounts: [] },
  }
}

function artifact(model: RComposition, value: CompositionProgramPayload): ProgramArtifact<CompositionProgramPayload> {
  return {
    ref: { entityType: 'composition' as const, id: model.id, identity: model.identity },
    sourceHash: `test:${model.identity}`, compilerVersion: 'test', contextHash: 'test', status: 'valid' as const,
    diagnostics: [], dependencies: [], capabilities: ['compilable', 'executable'], metadata: { self: {}, nodes: [] }, payload: value,
  }
}
