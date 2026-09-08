import type { ComponentSFCEventPort } from '@/features/core/modules/domain/types/component/sfc/ports.types'
import type { ProgramEntityType } from '@/features/core/modules/program/domain/types/program.types'
import type { ComponentSFCRuntimeHost } from '@/features/core/modules/runtime/hosts/ComponentSFCRuntimeHost'
import { Raph } from '@endge/raph'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { compileComponentSFC } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-compile'
import { RAction } from '@/features/core/modules/domain/entities/RAction'
import { RComponentSFC } from '@/features/core/modules/domain/entities/RComponentSFC'
import { RComposition } from '@/features/core/modules/domain/entities/RComposition'
import { RFilter } from '@/features/core/modules/domain/entities/RFilter'
import { RQuery } from '@/features/core/modules/domain/entities/RQuery'
import { RStore } from '@/features/core/modules/domain/entities/RStore'
import { RUpdate } from '@/features/core/modules/domain/entities/RUpdate'
import { RuntimeScope } from '@/features/core/modules/runtime/RuntimeScope'

/** Публикует скомпилированную программу без зависимости от workspace и сети. */
function publish(type: ProgramEntityType, model: { id: number, identity: string }, payload: unknown): void {
  Endge.program.addArtifact({
    ref: { entityType: type, id: model.id, identity: model.identity },
    sourceHash: 'test',
    compilerVersion: 'test',
    status: 'valid',
    diagnostics: [],
    dependencies: [],
    capabilities: ['compilable', 'executable'],
    metadata: { self: {}, nodes: [] },
    payload,
  })
}

function addComposition(identity: string, source: string, id = 10): void {
  const model = Object.assign(new RComposition(), { id, identity, name: identity, source })
  Endge.domain.addComposition(model)
  const compiled = Endge.source.compile('composition', source)
  expect(compiled.ok).toBe(true)
  publish('composition', model, compiled.artifact)
}

function addAction(identity: string, source: string, id = 20): void {
  const model = Object.assign(new RAction(), { id, identity, name: identity, source, defaultImplementation: { kind: 'source' } })
  Endge.domain.addAction(model)
  const compiled = Endge.source.compile('action', source)
  expect(compiled.ok).toBe(true)
  publish('action', model, compiled.artifact)
}

async function mountStoreOwner() {
  const store = Object.assign(new RStore(), { id: 1, identity: 'db', name: 'db', source: 'defineStore({data:{counter:value(0)}})' })
  Endge.domain.addStore(store)
  publish('store', store, { ...Endge.source.compile('store', store.source).artifact, updateHandlers: [{ identity: 'set-counter', eventTypes: [] }] })
  const update = Object.assign(new RUpdate(), { id: 2, identity: 'set-counter', name: 'set-counter', storeIdentity: 'db', source: 'defineUpdate({mutations:[{strategy:\'set\',target:\'counter\',value:1}]})' })
  Endge.domain.addUpdate(update)
  publish('update', update, { ...Endge.source.compile('update', update.source).artifact, storeIdentity: 'db' })
  const filter = Object.assign(new RFilter(), { id: 4, identity: 'controller', name: 'controller', source: 'defineFilter({fields:{},outputs:{}})' })
  Endge.domain.addFilter(filter)
  publish('filter', filter, Endge.source.compile('filter', filter.source).artifact)
  addComposition('owner', 'defineComposition({data:{db:store(\'db\')},resources:{history:operationHistory({limit:20})},runtimes:{controller:filter(\'controller\')}})')
  const session = await Endge.runtime.composition.mount('owner')
  const parent = session.host.getChild('controller')!
  return { session, parent, scope: session.host.getScope('scope_default')!, history: Endge.runtime.operations.resolveForHost(parent)! }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('регрессии связанного выполнения Action и lifecycle Core', () => {
  beforeEach(() => {
    Endge.actions.setup()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await Endge.runtime.reset()
    Endge.actions.reset()
    Endge.vocabs.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Raph.app.reset()
  })

  /** Вложенные именованные Actions не входят повторно в занятую очередь History. */
  it('сохраняет одну запись History при вложенных Actions в run, undo и redo', async () => {
    const { parent, history } = await mountStoreOwner()
    addAction('inner', 'defineAction({steps:{edit:operation({run:{steps:{},output:input(\'value\')},undo:{steps:{}}})},output:output(\'edit\')})', 21)
    addAction('outer', `defineAction({steps:{edit:operation({
      run:{steps:{nested:action({identity:'inner',input:{value:1}})},output:output('nested')},
      undo:{steps:{nested:action({identity:'inner',input:{value:0}})},output:output('nested')}
    })},output:output('edit')})`)
    await expect(Endge.actions.execute('outer', { input: {}, context: { parentRuntimeId: parent.id } })).resolves.toBe(1)
    expect(history.snapshot()).toMatchObject({ size: 1, cursor: 1 })
    await expect(history.undo()).resolves.toBe(0)
    await expect(history.redo()).resolves.toBe(1)
    await expect(history.undo()).resolves.toBe(0)
    expect(history.snapshot()).toMatchObject({ size: 1, cursor: 0 })
    await Endge.actions.execute('outer', { context: { parentRuntimeId: parent.id } })
    expect(history.snapshot()).toMatchObject({ size: 1, cursor: 1 })
  })

  /** Inline SFC Operation использует ту же History при вызове Source Action. */
  it('не создаёт вложенную запись History через SFC Operation → Action', async () => {
    const { parent, history } = await mountStoreOwner()
    addAction('inner', 'defineAction({steps:{edit:operation({run:{steps:{},output:1},undo:{steps:{}}})}})')
    const source = `<template><Text value="OLD" editable @edited="operation({
      run: action({identity:'inner',input:{}}),
      undo: action({identity:'inner',input:{}})
    })" /></template>`
    const model = Object.assign(new RComponentSFC(), { id: 30, identity: 'inline-owner', name: 'inline-owner', source })
    Endge.domain.addComponentSFC(model)
    const compiled = compileComponentSFC(source)
    expect(compiled.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    publish('component-sfc', model, compiled)
    const host = Endge.runtime.execute(model, { parent }) as ComponentSFCRuntimeHost
    const root = compiled.ir!.template!.roots[0]!
    if (root.kind !== 'element') {
      throw new Error('Missing compiled element')
    }
    const port: ComponentSFCEventPort = { kind: 'event', role: 'emits', name: 'edited', payloadType: 'unknown', action: root.events![0]!.action }
    await host.executeEventPortAction(model.identity, port, {}, undefined, async () => {}, [], 0)
    expect(history.snapshot()).toMatchObject({ size: 1, cursor: 1 })
    await history.undo()
    await history.redo()
    expect(history.snapshot()).toMatchObject({ size: 1, cursor: 1 })
  })

  /** Отмена transport должна отменить весь Action до следующей записи в Store. */
  it('останавливает Query → Update при паузе scope', async () => {
    const { session, parent, scope } = await mountStoreOwner()
    const query = Object.assign(new RQuery(), { id: 3, identity: 'q', name: 'q' })
    Endge.domain.addQuery(query)
    publish('query', query, { type: 'query-rest', sourceVersion: 2, endpoint: 'https://no-network.invalid', query: '/search', props: [], requestBody: null, outputs: [] })
    const started = deferred<void>()
    let signal!: AbortSignal
    vi.spyOn(Endge.runtime.query, 'executeArtifact').mockImplementation(input => new Promise((_resolve, reject) => {
      signal = input.signal!
      signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
      started.resolve()
    }))
    addAction('outer', 'defineAction({steps:{load:query({identity:\'q\',input:{}}),write:update({identity:\'set-counter\',input:{}})}})')
    const rejected = expect(Endge.actions.execute('outer', { context: { parentRuntimeId: parent.id } })).rejects.toMatchObject({ name: 'AbortError' })
    await started.promise
    await scope.pause()
    await rejected
    expect(signal.aborted).toBe(true)
    expect(session.host.getDataSnapshot()).toEqual({ db: { counter: 0 } })
  })

  /** Даже неотменяемый collaborator не оживляет старое выполнение после resume. */
  it('не продолжает Action после паузы и возобновления во время computation', async () => {
    const { session, parent, scope } = await mountStoreOwner()
    const request = deferred<unknown>()
    const run = vi.spyOn(Endge.computations, 'run').mockReturnValue(request.promise)
    addAction('outer', 'defineAction({steps:{wait:computation(\'slow\',{}),write:update({identity:\'set-counter\',input:{}})}})')
    const rejected = expect(Endge.actions.execute('outer', { context: { parentRuntimeId: parent.id } })).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
    await scope.pause()
    await scope.resume()
    request.resolve({})
    await rejected
    expect(session.host.getDataSnapshot()).toEqual({ db: { counter: 0 } })
  })

  /** История остаётся пригодной к использованию после смены поколения scope. */
  it('выполняет undo и default redo после паузы и resume', async () => {
    const { parent, history, scope } = await mountStoreOwner()
    addAction('outer', 'defineAction({steps:{edit:operation({run:{steps:{},output:1},undo:{steps:{},output:0}})},output:output(\'edit\')})')
    await Endge.actions.execute('outer', { context: { parentRuntimeId: parent.id } })
    await scope.pause()
    await scope.resume()
    await expect(history.undo()).resolves.toBe(0)
    await expect(history.redo()).resolves.toBe(1)
  })

  /** Ошибка одного cleanup не удерживает другие hosts и инфраструктуру Runtime. */
  it('завершает reset и допускает повторный запуск после ошибки cleanup', async () => {
    const { session, parent } = await mountStoreOwner()
    const nodeId = parent.node!.id
    const original = parent.destroy.bind(parent)
    vi.spyOn(parent, 'destroy').mockImplementation(() => {
      original()
      throw new Error('cleanup failure')
    })
    await expect(Endge.runtime.reset()).rejects.toBeInstanceOf(AggregateError)
    expect(Endge.runtime.getRuntimeHosts()).toEqual([])
    expect(Endge.runtime.scopes.getAll()).toEqual([])
    expect(session.host.status).toBe('destroyed')
    expect(Raph.app.getNode(nodeId)).toBeUndefined()
    expect(Raph.app.getNode('__endge.runtime.app')).toBeUndefined()
    const restarted = await Endge.runtime.composition.mount('owner')
    expect(restarted.host.status).toBe('active')
    expect(restarted.host.getDataSnapshot()).toEqual({ db: { counter: 0 } })
    await restarted.unmount()
  })

  /** Прямой destroy Composition также освобождает Store и scopes после ошибки child. */
  it('освобождает ресурсы Composition при ошибке дочернего destroy', async () => {
    addComposition('child', 'defineComposition({runtimes:{}})', 11)
    addComposition('owner', 'defineComposition({runtimes:{nested:composition(\'child\')}})')
    const session = await Endge.runtime.composition.mount('owner')
    const child = session.host.getChild('nested')!
    const original = child.destroy.bind(child)
    vi.spyOn(child, 'destroy').mockImplementation(async () => {
      await original()
      throw new Error('child cleanup failure')
    })
    const first = session.host.destroy()
    expect(session.host.destroy()).toBe(first)
    await expect(first).rejects.toBeInstanceOf(AggregateError)
    expect(session.host.status).toBe('destroyed')
    expect(session.host.node).toBeNull()
    expect(session.host.getChildren()).toEqual([])
    expect(Endge.runtime.scopes.getAll().filter(scope => scope.ownerRuntimeId === session.host.id)).toEqual([])
    // Прямой host.destroy оставляет регистрацию её внешнему владельцу.
    vi.restoreAllMocks()
    await Endge.runtime.destroyRuntimeTreeAsync(session.id).catch(() => {})
  })

  /** Все корневые scopes освобождаются независимо от ошибки первого. */
  it('удаляет scopes из реестра и продолжает их dispose после исключения', async () => {
    const disposed = vi.fn()
    const first = Endge.runtime.scopes.register(new RuntimeScope({ id: 'first', path: 'first', hooks: { dispose: disposed } }))
    const second = Endge.runtime.scopes.register(new RuntimeScope({ id: 'second', path: 'second', hooks: { dispose: () => {
      throw new Error('scope failure')
    } } }))
    await expect(Endge.runtime.scopes.reset()).rejects.toBeInstanceOf(AggregateError)
    expect(disposed).toHaveBeenCalledOnce()
    expect(first.state).toBe('disposed')
    expect(second.state).toBe('disposed')
    expect(Endge.runtime.scopes.getAll()).toEqual([])
  })

  /** Все вызывающие стороны ожидают один mount и получают один готовый host. */
  it.each(['success', 'failure'] as const)('объединяет параллельный activate вложенной Composition: %s', async (outcome) => {
    addComposition('child', 'defineComposition({data:{dict:vocab(\'dictionary\')},runtimes:{}})', 11)
    addComposition('owner', 'defineComposition({runtimes:{nested:composition(\'child\').activateOn(manual())}})')
    const request = deferred<Awaited<ReturnType<typeof Endge.vocabs.acquire>>>()
    const acquire = vi.spyOn(Endge.vocabs, 'acquire').mockReturnValue(request.promise)
    const session = await Endge.runtime.composition.mount('owner')
    const handle = session.host.getRuntimeHandle('nested')!
    const first = handle.activate()
    const settled = vi.fn()
    const observed = Promise.allSettled([first]).then((result) => {
      settled()
      return result[0]!
    })
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce())
    const second = handle.activate()
    expect(second).toBe(first)
    expect(settled).not.toHaveBeenCalled()
    if (outcome === 'failure') {
      request.reject(new Error('mount failed'))
      expect(await observed).toMatchObject({ status: 'rejected' })
      expect(handle.runtime).toBeNull()
    }
    else {
      request.resolve([])
      expect(await observed).toMatchObject({ status: 'fulfilled' })
      expect(await second).toBe(await first)
      expect(handle.state).toBe('active')
    }
    await session.unmount()
  })

  /** Deactivate инвалидирует старый mount, но сохраняет возможность следующей активации. */
  it('создаёт новый runtime после отмены pending activate через deactivate', async () => {
    addComposition('child', 'defineComposition({data:{dict:vocab(\'dictionary\')},runtimes:{}})', 11)
    addComposition('owner', 'defineComposition({runtimes:{nested:composition(\'child\').activateOn(manual())}})')
    const request = deferred<Awaited<ReturnType<typeof Endge.vocabs.acquire>>>()
    const acquire = vi.spyOn(Endge.vocabs, 'acquire').mockReturnValueOnce(request.promise).mockResolvedValue([])
    const session = await Endge.runtime.composition.mount('owner')
    const handle = session.host.getRuntimeHandle('nested')!
    const rejected = expect(handle.activate()).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce())
    const old = handle.runtime
    const stopping = handle.deactivate()
    const next = handle.activate()
    await stopping
    await rejected
    const current = await next
    request.resolve([])
    expect(current).not.toBe(old)
    expect(handle.runtime).toBe(current)
    expect(handle.state).toBe('active')
    await session.unmount()
  })

  /** Dispose отменяет pending acquire без ожидания сети и запрещает публикацию host. */
  it('отменяет pending activate при dispose вложенного handle', async () => {
    addComposition('child', 'defineComposition({data:{dict:vocab(\'dictionary\')},runtimes:{}})', 11)
    addComposition('owner', 'defineComposition({runtimes:{nested:composition(\'child\').activateOn(manual())}})')
    const request = deferred<Awaited<ReturnType<typeof Endge.vocabs.acquire>>>()
    const acquire = vi.spyOn(Endge.vocabs, 'acquire').mockReturnValue(request.promise)
    const session = await Endge.runtime.composition.mount('owner')
    const handle = session.host.getRuntimeHandle('nested')!
    const rejected = expect(handle.activate()).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce())
    await handle.dispose()
    await rejected
    request.resolve([])
    await expect(handle.activate()).rejects.toThrow('disposed')
    expect(handle.state).toBe('disposed')
    expect(handle.runtime).toBeNull()
    expect(Endge.runtime.getRuntimeHostsByEntity('composition', 'child')).toEqual([])
  })
})
