import type { ProgramArtifact } from '@/features/core/modules/program/domain/types/program.types'

import type { RuntimeScopeHandle } from '@/features/core/modules/runtime/domain/runtime-scope.types'
import type { CompositionProgramPayload } from '@/features/core/modules/source/domain/types/composition-source.types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { RComposition } from '@/features/core/modules/domain/entities/RComposition'
import { RProject } from '@/features/core/modules/domain/entities/RProject'

describe('проверка Runtime-сессия проекта Endge', () => {
  afterEach(async () => {
    await Endge.runtime.reset()
    Endge.program.clear()
    Endge.domain.reset()
    vi.restoreAllMocks()
  })

  /** Самостоятельные документы не становятся неявными корнями запуска проекта. */
  it('запускает собственный артефакт проекта и не активирует несвязанные композиции', async () => {
    const project = RProject.fromPlain({ id: 501, identity: 'airport', name: 'Airport' })
    Endge.domain.addProject(project)
    const legacy = composition(502, 'standalone')
    Endge.domain.addComposition(legacy)
    Endge.program.addArtifact(artifact(legacy, payload('startup')))
    Endge.program.addArtifact(artifact(project, payload('startup')))

    const session = await Endge.runtime.project.mount('airport')
    expect(session.composition.identity).toBe('airport')
    expect(session.composition.state).toBe('active')
    expect(session.composition.host?.entityType).toBe('project')
    expect(Endge.runtime.getRuntimeHostsByEntity('composition', legacy.identity)).toEqual([])
    expect(Endge.domain.getComposition(legacy.identity)).toBe(legacy)

    await session.unmount()
    expect(Endge.runtime.getRuntimeHosts()).toEqual([])
    expect(Endge.runtime.scopes.getAll().filter(scope => scope.ownerRuntimeId === session.id)).toEqual([])
  })

  /** Наличие Composition не маскирует отсутствие project artifact. */
  it('отклоняет запуск без артефакта проекта даже при наличии самостоятельной композиции', async () => {
    const project = RProject.fromPlain({ id: 507, identity: 'missing', name: 'Missing' })
    const legacy = composition(508, 'standalone')
    Endge.domain.addProject(project)
    Endge.domain.addComposition(legacy)
    Endge.program.addArtifact(artifact(legacy, payload('startup')))
    await expect(Endge.runtime.project.mount('missing')).rejects.toThrow('cannot be mounted')
    expect(Endge.runtime.getRuntimeHosts()).toEqual([])
  })

  it('поддерживает отладочное монтирование без автоактивации и повторное использование handles pause/resume/restart', async () => {
    const project = RProject.fromPlain({ id: 505, identity: 'debug-project', name: 'Debug project' })
    Endge.domain.addProject(project)
    Endge.program.addArtifact(artifact(project, payload('startup')))

    const session = await Endge.runtime.project.mount('debug-project', { autoActivate: 'none' })
    const handle = session.composition
    expect(handle.state).toBe('inactive')
    expect(handle.host?.entityType).toBe('project')

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

  it('объединяет параллельную активацию и отменяет незавершённый запуск', async () => {
    const project = RProject.fromPlain({ id: 520, identity: 'concurrent', name: 'Concurrent' })
    Endge.domain.addProject(project)
    Endge.program.addArtifact(artifact(project, payload('manual')))
    const session = await Endge.runtime.project.mount('concurrent', { autoActivate: 'none' })
    const handle = session.composition
    const first = handle.activate()
    const second = handle.activate()
    const [one, two] = await Promise.all([first, second])
    expect(one.host).toBe(two.host)
    expect(Endge.runtime.getRuntimeHostsByEntity('project', 'concurrent')).toHaveLength(1)
    await handle.deactivate()
    const pending = handle.activate()
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await handle.deactivate()
    await rejected
    expect(handle.host).toBeNull()
    expect(Endge.runtime.getRuntimeHostsByEntity('project', 'concurrent')).toEqual([])
    await handle.activate()
    await session.unmount()
    await expect(handle.activate()).rejects.toThrow('disposed')
    expect(Endge.runtime.getRuntimeHosts()).toEqual([])
  })

  it('отменяет ожидание Vocab при закрытии проекта', async () => {
    const project = RProject.fromPlain({ id: 530, identity: 'pending', name: 'Pending' })
    Endge.domain.addProject(project)
    const compiled = Endge.source.compile('composition', 'defineComposition({ data: { dictionary: vocab(\'dictionary\') }, runtimes: {} })')
    Endge.program.addArtifact(artifact(project, compiled.artifact as CompositionProgramPayload))
    let release!: () => void
    vi.spyOn(Endge.vocabs, 'acquire').mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve([])
    }))
    const session = await Endge.runtime.project.mount('pending', { autoActivate: 'none' })
    const handle = session.composition
    const pending = handle.activate()
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const closing = session.unmount()
    expect(session.unmount()).toBe(closing)
    await closing
    await rejected
    release()
    await Promise.resolve()
    expect(handle.state).toBe('disposed')
    expect(handle.host).toBeNull()
    expect(Endge.runtime.getRuntimeHosts()).toEqual([])
  })

  it('атомарно переключает именованные scopes и отклоняет handles другой сессии проекта', async () => {
    const project = RProject.fromPlain({ id: 510, identity: 'airport', name: 'Airport' })
    Endge.domain.addProject(project)
    Endge.program.addArtifact(artifact(project, payloadWithPages()))

    const firstSession = await Endge.runtime.project.mount('airport')
    const firstEntry = firstSession.composition
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
    const foreignPage = secondSession.composition
      .output<RuntimeScopeHandle>('pageA')!
    await expect(firstSession.switchScope({ to: foreignPage })).rejects.toThrow('another or disposed session')

    await secondSession.unmount()
    await firstSession.unmount()
    expect(Endge.runtime.getRuntimeHosts()).toEqual([])
  })
})

function composition(id: number, identity: string): RComposition {
  const value = new RComposition()
  value.id = id
  value.identity = identity
  value.name = identity
  return value
}

function payload(mode: 'startup' | 'manual'): CompositionProgramPayload {
  return {
    type: 'composition',
    sourceVersion: 1,
    activation: { mode },
    props: [],
    data: [],
    resources: [],
    runtimes: [],
    hooks: [],
    outputs: [],
    scopes: [{
      name: 'scope_default',
      path: 'scope_default',
      parentPath: null,
      activationOverride: { mode },
      effectiveActivation: { mode },
      resources: [],
      runtimes: [],
      children: [],
      sourceOrder: 0,
    }],
    graph: { inputs: [], dataInputs: [], updates: [], publications: [], mounts: [] },
  }
}

function payloadWithPages(): CompositionProgramPayload {
  return {
    type: 'composition',
    sourceVersion: 1,
    activation: { mode: 'startup' },
    props: [],
    data: [],
    resources: [],
    runtimes: [],
    hooks: [],
    scopes: [
      {
        name: 'scope_default',
        path: 'scope_default',
        parentPath: null,
        activationOverride: { mode: 'startup' },
        effectiveActivation: { mode: 'startup' },
        resources: [],
        runtimes: [],
        children: ['pageA', 'pageB'],
        sourceOrder: 0,
      },
      {
        name: 'pageA',
        path: 'pageA',
        parentPath: 'scope_default',
        activationOverride: { mode: 'manual' },
        effectiveActivation: { mode: 'manual' },
        resources: [],
        runtimes: [],
        children: [],
        sourceOrder: 1,
      },
      {
        name: 'pageB',
        path: 'pageB',
        parentPath: 'scope_default',
        activationOverride: { mode: 'manual' },
        effectiveActivation: { mode: 'manual' },
        resources: [],
        runtimes: [],
        children: [],
        sourceOrder: 2,
      },
    ],
    outputs: [
      { key: 'pageA', kind: 'scope', scope: 'pageA' },
      { key: 'pageB', kind: 'scope', scope: 'pageB' },
    ],
    graph: { inputs: [], dataInputs: [], updates: [], publications: [], mounts: [] },
  }
}

function artifact(model: RComposition | RProject, value: CompositionProgramPayload): ProgramArtifact<CompositionProgramPayload> {
  return {
    ref: { entityType: model instanceof RProject ? 'project' : 'composition', id: model.id, identity: model.identity },
    sourceHash: `test:${model.identity}`,
    compilerVersion: 'test',
    contextHash: 'test',
    status: 'valid' as const,
    diagnostics: [],
    dependencies: [],
    capabilities: ['compilable', 'executable'],
    metadata: { self: {}, nodes: [] },
    payload: value,
  }
}
