import type { ComponentSFCRuntimeHost } from '@/features/core/modules/runtime/hosts/ComponentSFCRuntimeHost'
import { Raph, RaphSchedulerType } from '@endge/raph'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { compileComponentSFC } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-compile'
import { ComputationResourceState } from '@/features/core/modules/computations/model/ComputationResource'
import { RComponentSFC } from '@/features/core/modules/domain/entities/RComponentSFC'
import { RStore } from '@/features/core/modules/domain/entities/RStore'
import { EndgeRuntime_Module } from '@/features/core/modules/runtime/EndgeRuntime_Module'
import { RuntimeScope } from '@/features/core/modules/runtime/RuntimeScope'
import { runtimeInspectionMetaKey } from '@/features/core/modules/runtime/tools/runtime-render-inspection'
import { inspectionFixture } from './fixtures/runtime-inspection'

const application = { mode: 'application', scope: {}, vars: {} } as const
const modules: EndgeRuntime_Module[] = []

function passiveRuntime() {
  const runtime = new EndgeRuntime_Module()
  runtime.setup({ ...application, mode: 'debugger' })
  modules.push(runtime)
  return runtime
}

afterEach(async () => {
  for (const runtime of modules.splice(0)) {
    await runtime.reset()
  }
  await Endge.reset()
  Endge.runtime.setup(application)
  Raph.app.reset()
  vi.restoreAllMocks()
})

describe('наблюдение Runtime и управление через Commands', () => {
  /** Renderer получает привязки и уже вычисленное состояние; capture не повторяет бизнес-вычисления. */
  it('сохраняет входы SFC, Meta и computation вместе с данными Raph без повторного execution', () => {
    Endge.runtime.setup(application)
    const model = RComponentSFC.fromPlain({ id: 'inspection-sfc', identity: 'inspection-sfc', source: `<script setup lang="ts">defineProps<{ count: number }>()</script><template><Text>{{ count }} {{ $data.metaOf(count, 'inspection')?.status }}</Text></template>` })
    Endge.domain.addComponentSFC(model)
    const compiled = compileComponentSFC(model.source, { identity: model.identity })
    Endge.program.addArtifact({ ref: { entityType: 'component-sfc', id: model.id, identity: model.identity }, sourceHash: 'test', compilerVersion: 'test', status: 'valid', diagnostics: [], dependencies: [], capabilities: ['renderable'], metadata: compiled.metadata, payload: compiled })
    const host = Endge.runtime.execute(model, { id: 'inspection-sfc-instance' }) as ComponentSFCRuntimeHost
    host.setInputSource({ kind: 'raph', bindings: { count: { path: 'inspection.count' } } })
    Raph.set('inspection.count', 7)
    Raph.meta.set('inspection.count', 'inspection', { status: 'waiting' })
    const run = vi.fn(value => Number(value) * 2)
    vi.spyOn(Endge.computations, 'createResource').mockImplementation((identity, input) => new ComputationResourceState(input, async value => value, run, identity))
    host.getComputationResource('double', 7, 'renderer:123:double')
    const capture = Endge.runtime.captureInspection(true)
    const render = capture.render?.hosts[host.id]
    expect(render?.kind === 'component-sfc' && Object.values(render.dataMeta)).toContainEqual({ status: 'waiting' })
    expect(render).toMatchObject({ kind: 'component-sfc', input: { kind: 'raph', bindings: { count: { path: 'inspection.count' } } }, computations: [{ identity: 'double', input: 7, value: 14, status: 'success' }] })
    const passive = passiveRuntime()
    passive.applyInspectionSnapshot(JSON.parse(JSON.stringify(capture)))
    expect(passive.inspection.render).toEqual(capture.render)
    expect(run).toHaveBeenCalledTimes(1)
    expect(passive.getRuntimeById(host.id)).toBeNull()
    expect(runtimeInspectionMetaKey({ kind: 'prop', prop: 'count', path: [] })).toBe(runtimeInspectionMetaKey({ prop: 'count', path: [], kind: 'prop' }))
  })
  /** Импорт обновляет только пассивную проекцию, включая независимые экземпляры документа. */
  it('импортирует данные и статусы без hosts, Raph-записей и событий в обратную сторону', () => {
    const runtime = passiveRuntime()
    const execute = vi.spyOn(Endge.commands, 'execute')
    const addPhase = vi.spyOn(Raph, 'addPhase')
    const set = vi.spyOn(Raph, 'set')
    const events = vi.spyOn(Endge.events, 'emitEvent')
    const changed = vi.fn()
    runtime.subscribe(changed)
    runtime.start()
    runtime.applyInspectionSnapshot(inspectionFixture())
    runtime.applyInspectionEvent({ id: 'host-1', previous: 'running', value: 'paused' })
    expect(runtime.snapshot().hosts.map(host => host.status)).toEqual(['running', 'paused'])
    expect(runtime.snapshot().byStatus).toEqual({ running: 1, paused: 1 })
    expect(runtime.getRuntimeById('host-0')).toBeNull()
    expect(runtime.snapshotRaph({ includeData: true, includeGraph: false }).data).toEqual(inspectionFixture().data)
    expect(changed).toHaveBeenCalledTimes(2)
    expect(addPhase).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
    expect(events).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  /** Повреждённая топология не должна частично заменить предыдущее дерево. */
  it('отклоняет повторные id и циклы атомарно, сохраняя ошибку данных до успешного обновления', () => {
    const runtime = passiveRuntime()
    runtime.applyInspectionSnapshot(inspectionFixture())
    const previous = runtime.inspection
    const duplicate = inspectionFixture()
    duplicate.runtime.hosts[1]!.id = 'host-0'
    expect(() => runtime.applyInspectionSnapshot(duplicate)).toThrow('descriptor')
    const cyclic = inspectionFixture()
    cyclic.runtime.hosts[0]!.parentId = 'host-1'
    cyclic.runtime.hosts[1]!.parentId = 'host-0'
    expect(() => runtime.applyInspectionSnapshot(cyclic)).toThrow('Cyclic')
    expect(runtime.inspection).toBe(previous)
    runtime.applyInspectionDataError('size limit')
    const topology = inspectionFixture()
    delete topology.data
    delete topology.dataGeneratedAt
    runtime.applyInspectionSnapshot(topology)
    expect(runtime.inspection.dataError).toBe('size limit')
    expect(runtime.inspection.dataGeneratedAt).toBe(10)
    runtime.applyInspectionData({ fresh: true }, 20)
    expect(runtime.inspection.dataError).toBeUndefined()
    runtime.clearInspection()
    expect(runtime.snapshot().hosts).toEqual([])
    expect(runtime.inspection.data).toBeUndefined()
  })

  /** Реальный Raph watcher имеет одного owner, независимо от числа наблюдателей. */
  it('публикует лёгкие изменения вложенных данных только пока существует lease', () => {
    Endge.runtime.setup(application)
    Raph.options({ scheduler: RaphSchedulerType.Sync })
    const watch = vi.spyOn(Raph, 'watch')
    const changes = vi.fn()
    const off = Endge.events.onEvent('runtime:data-changed', changes)
    const first = Endge.runtime.acquireDataChanges()
    const second = Endge.runtime.acquireDataChanges()
    Raph.set('inspection.rows', [{ id: 1, value: 10 }])
    Raph.set('inspection.rows[id=1].value', 20)
    expect(changes).toHaveBeenCalled()
    expect(watch).toHaveBeenCalledTimes(1)
    changes.mockClear()
    Raph.meta.set('inspection.rows[id=1].value', 'inspection', { status: 'waiting' })
    expect(changes).toHaveBeenCalled()
    const before = changes.mock.calls.length
    first.release()
    second.release()
    second.release()
    Raph.set('inspection.rows[id=1].value', 30)
    Raph.meta.set('inspection.rows[id=1].value', 'inspection', { status: 'ready' })
    expect(changes).toHaveBeenCalledTimes(before)
    off()
  })

  /** Адрес поколения исключает управление заменённым scope через запоздалый клик. */
  it('управляет настоящим scope через локальные Commands и отвергает старое поколение', async () => {
    Endge.runtime.setup(application)
    Endge.commands.setup(application)
    const scope = Endge.runtime.scopes.register(new RuntimeScope({ id: 'inspect-scope', path: 'scope_default' }))
    await scope.activate()
    const target = { kind: 'scope', id: scope.id, generation: scope.snapshot().generation } as const
    await Endge.commands.execute({ type: 'runtime:pause', payload: target })
    expect(scope.state).toBe('paused')
    await Endge.commands.execute({ type: 'runtime:resume', payload: target })
    expect(scope.state).toBe('active')
    await Endge.commands.execute({ type: 'runtime:stop', payload: { ...target, generation: scope.snapshot().generation } })
    expect(scope.state).toBe('inactive')
    await expect(Endge.commands.execute({ type: 'runtime:resume', payload: target })).rejects.toThrow('instance changed')
  })

  /** Снимок настоящего Store проходит wire JSON roundtrip, но не создаёт Store на наблюдателе. */
  it('передаёт реальный Store с данными и управляет только выбранным экземпляром', async () => {
    Endge.runtime.setup(application)
    Endge.commands.setup(application)
    const store = Object.assign(new RStore(), { id: 'inspect-store', identity: 'inspect-store', name: 'Inspection Store', source: 'defineStore({ data: { rows: value([{ id: 1 }]) } })' })
    Endge.domain.addStore(store)
    Endge.program.addArtifact({ ref: { entityType: 'store', id: store.id, identity: store.identity }, sourceHash: 'test', compilerVersion: 'test', status: 'valid', diagnostics: [], dependencies: [], capabilities: ['executable'], metadata: { self: {}, nodes: [] }, payload: Endge.source.compile('store', store.source).artifact })
    const first = Endge.runtime.execute(store, { id: 'inspection-first' })!
    const second = Endge.runtime.execute(store, { id: 'inspection-second' })!
    const passive = passiveRuntime()
    passive.applyInspectionSnapshot(JSON.parse(JSON.stringify(Endge.runtime.captureInspection(true))))
    expect(passive.snapshot().hosts.filter(host => host.entityIdentity === store.identity)).toHaveLength(2)
    expect(passive.inspection.data).toBeDefined()
    const target = { kind: 'host', id: first.id, createdAt: first.createdAt } as const
    await Endge.commands.execute({ type: 'runtime:pause', payload: target })
    expect(first.status).toBe('paused')
    expect(second.status).not.toBe('paused')
    await expect(Endge.commands.execute({ type: 'runtime:stop', payload: { ...target, createdAt: -1 } })).rejects.toThrow()
    await Endge.commands.execute({ type: 'runtime:resume', payload: target })
    expect(first.status).not.toBe('paused')
  })
})
