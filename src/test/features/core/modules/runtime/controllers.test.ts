import type { ControllerContext, ControllerDefinition } from '@/features/core/modules/runtime/domain/controllers/controller.types'
import { Raph } from '@raphy-js/raph'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { RComponentSFC } from '@/features/core/modules/domain/entities/RComponentSFC'
import { RComposition } from '@/features/core/modules/domain/entities/RComposition'
import { RQuery } from '@/features/core/modules/domain/entities/RQuery'
import { compileCompositionSource } from '@/features/core/modules/source/services/compilers/composition-source-compile'
import { createUpdateStoreRuntime } from '@/test/fixtures/update-source'
import { prepareTestCompilerContext, resetTestCompilerContext } from '@/test/helpers/compiler-context'

const removers: Array<() => void> = []
beforeEach(() => {
  prepareTestCompilerContext()
  Endge.context.setDataMode('live')
})
afterEach(async () => {
  await Endge.runtime.reset()
  removers.splice(0).reverse().forEach(remove => remove())
  resetTestCompilerContext()
  Raph.reset()
  vi.restoreAllMocks()
})
function owner() {
  return createUpdateStoreRuntime({
    storeSource: 'defineStore({data:{window:value({revision:0,rowsRevision:0,blocks:[]})}})',
    updates: [{
      identity: 'commit-window',
      source: `defineUpdate({mutations:[{strategy:'set',target:'window',value:input('next'),when:eq(data('window.revision'),input('expectedRevision'))}]})`,
    }],
  })
}
function query() {
  const query = Object.assign(new RQuery(), {
    id: 901,
    identity: 'load-page',
    sourceVersion: 2,
    source: `defineQuery({kind:'rest',props:defineProps({status:field('String').optional(),direction:field('String').optional(),cursor:field('String').optional(),offset:field('Number').optional(),limit:field('Number').default(100)}),request:{endpoint:'https://api.example.test',path:'/rows',method:'GET'},outputs:{page:output().from(response())}})`,
  })
  Endge.domain.addQuery(query)
  const artifact = Endge.compiler.buildQuery(query)
  expect(artifact.status, JSON.stringify(artifact.diagnostics)).not.toBe('error')
  return query
}
function definition(identity = 'test.counter'): ControllerDefinition {
  return {
    identity,
    displayName: identity,
    origin: {
      kind: 'local',
      owner: 'controller-test',
    },
    defaultProviderKey: identity,
    contract: {
      props: [{
        key: 'value',
        type: 'Number',
        array: false,
        optional: true,
        defaultValue: {
          type: 'literal',
          value: 1,
        },
      }],
      outputs: [{
        key: 'value',
        type: 'Number',
        array: false,
        optional: false,
      }],
      commands: {
        increment: {},
      },
      dependencies: {},
    },
  }
}
function register(value: ControllerDefinition, create: Parameters<typeof Endge.runtime.controllers.provide>[0]['create']) {
  removers.push(Endge.runtime.controllers.define(value))
  removers.push(Endge.runtime.controllers.provide({
    identity: value.identity,
    key: value.defaultProviderKey,
    create,
  }))
}
async function mountWindow(store: ReturnType<typeof owner>, props: Record<string, unknown> = {}) {
  return Endge.runtime.controllers.mount('endge.collection-window', {
    owner: store,
    props: {
      autoLoad: false,
      batchSize: 10,
      prefetchRows: 2,
      maxLoadedRows: 20,
      ...props,
    },
    dependencies: {
      state: {
        store,
        path: 'window',
        update: 'commit-window',
      },
      load: {
        query: 'load-page',
        output: 'page',
      },
    },
  })
}
function page(start: number, count = 10, total = 100) {
  return {
    rows: Array.from({
      length: count,
    }, (_, index) => ({
      id: String(start + index),
      value: start + index,
    })),
    offset: start,
    total,
    startCursor: String(start),
    endCursor: String(start + count),
    hasBefore: start > 0,
    hasAfter: start + count < total,
  }
}
function viewport(host: Awaited<ReturnType<typeof mountWindow>>, first = 0, last = 9) {
  const outputs = host.getOutputs()
  const rows = outputs.rows as {
    id: string
  }[]
  return {
    rowsRevision: outputs.rowsRevision,
    firstVisible: {
      key: rows[first].id,
      index: first,
    },
    lastVisible: {
      key: rows[last].id,
      index: last,
    },
    rowCount: rows.length,
    reason: 'scroll',
  }
}
describe('controllers registry, SDK and lifecycle', () => {
  it('isolates instances, validates props/commands and destroys owned nodes', async () => {
    const store = owner()
    const value = definition()
    register(value, (context) => {
      let counter = Number(context.props.value)
      return {
        start(ctx) {
          ctx.publish({
            value: counter,
          })
        },
        command(_name, _input, ctx) {
          ctx.publish({
            value: ++counter,
          })
        },
      }
    })
    const a = await Endge.runtime.controllers.mount(value.identity, {
      owner: store,
    })
    const b = await Endge.runtime.controllers.mount(value.identity, {
      owner: store,
      props: {
        value: 10,
      },
    })
    await a.command('increment')
    expect(a.getOutput('value')).toBe(2)
    expect(b.getOutput('value')).toBe(10)
    await expect(a.setProps({
      value: 'bad',
    })).rejects.toThrow('controller-value-type')
    await expect(a.command('toString')).rejects.toThrow('controller-command-missing')
    await expect(a.command('missing')).rejects.toThrow('controller-command-missing')
    await expect(Endge.runtime.controllers.mount(value.identity, {
      owner: 'missing',
    })).rejects.toThrow('owner-required')
    await Endge.runtime.destroyRuntimeTreeAsync(a.id)
    expect(Endge.runtime.getRuntimeById(a.id)).toBeNull()
  })
  it('rejects collisions, missing providers and invalid dependency targets', async () => {
    const store = owner()
    const value = definition('test.missing')
    removers.push(Endge.runtime.controllers.define(value))
    expect(() => Endge.runtime.controllers.define(value)).toThrow('collision')
    await expect(Endge.runtime.controllers.mount(value.identity, {
      owner: store,
    })).rejects.toThrow('provider-missing')
    query()
    await expect(Endge.runtime.controllers.mount('endge.collection-window', {
      owner: store,
      dependencies: {
        state: {
          store,
          path: 'missing',
          update: 'commit-window',
        },
        load: {
          query: 'load-page',
          output: 'page',
        },
      },
    })).rejects.toThrow('state-invalid')
  })
  it('invalidates old execution contexts on pause/resume and input changes while keeping instance state', async () => {
    const store = owner()
    const contexts: ControllerContext[] = []
    let pauses = 0
    register(definition(), (context) => {
      contexts.push(context)
      let count = 0
      return {
        start(ctx) {
          ctx.publish({
            value: count,
          })
        },
        command(_name, _input, ctx) {
          contexts.push(ctx)
          ctx.publish({
            value: ++count,
          })
        },
        async pause() {
          await Promise.resolve()
          pauses++
        },
        resume(ctx) {
          contexts.push(ctx)
        },
        setProps(_props, ctx) {
          contexts.push(ctx)
        },
      }
    })
    const host = await Endge.runtime.controllers.mount('test.counter', {
      owner: store,
    })
    await host.pause()
    await host.pause()
    expect(pauses).toBe(1)
    await host.resume()
    await host.resume()
    contexts[0].publish({
      value: 900,
    })
    expect(host.getOutput('value')).toBe(0)
    await host.command('increment')
    expect(host.getOutput('value')).toBe(1)
    const previous = contexts.at(-1)!
    await host.setProps({
      value: 2,
    })
    previous.publish({
      value: 901,
    })
    expect(host.getOutput('value')).toBe(1)
    expect(contexts[0].signal.aborted).toBe(true)
    expect(Object.isFrozen(contexts.at(-1)!.props)).toBe(true)
    host.stop()
    await host.resume()
    await expect(host.command('increment')).rejects.toThrow('inactive')
  })
  it.each(['inputs', 'lifecycle'])('rejects a superseded asynchronous command return (%s)', async (change) => {
    const store = owner()
    let complete!: (value: number) => void
    register(definition(), () => ({
      command: () => new Promise<number>((resolve) => { complete = resolve }),
    }))
    const host = await Endge.runtime.controllers.mount('test.counter', { owner: store })
    const pending = host.command('increment')
    if (change === 'inputs') {
      await host.setProps({ value: 2 })
    }
    else {
      await host.pause()
      await host.resume()
    }
    complete(900)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('cancels SDK mount promptly when its owner is destroyed during asynchronous start', async () => {
    const store = owner()
    let complete!: () => void
    const start = vi.fn(() => new Promise<void>((resolve) => {
      complete = resolve
    }))
    const destroy = vi.fn()
    const value = definition('test.pending-start')
    register(value, () => ({ start, destroy, command() {} }))
    let outcome: unknown = 'pending'
    const pending = Endge.runtime.controllers.mount(value.identity, { owner: store }).then(
      (host) => { outcome = host },
      (error) => { outcome = error },
    )
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1))
    try {
      await Endge.runtime.destroyRuntimeTreeAsync(store.id)
      await vi.waitFor(() => expect(outcome).toMatchObject({ name: 'AbortError' }), { timeout: 300 })
      expect(Endge.runtime.getRuntimeHostsByEntity('controller', value.identity)).toHaveLength(0)
      expect(destroy).toHaveBeenCalledTimes(1)
    }
    finally {
      complete()
      await pending
    }
    expect(outcome).toMatchObject({ name: 'AbortError' })
    // Lease disposal must succeed after the cancelled mount and its late completion.
    removers.splice(0).reverse().forEach(remove => remove())
  })

  it('starts exactly once before resume effects after an immediate pause before startup', async () => {
    const store = owner()
    const calls: string[] = []
    const value = definition('test.paused-start')
    register(value, () => ({
      start() { calls.push('start') },
      resume() { calls.push('resume') },
      command() {},
    }))
    Endge.compiler.buildController(value.identity)
    const host = Endge.runtime.execute(Endge.runtime.controllers.model(value.identity), { parent: store }) as import('@/features/core/modules/runtime/hosts/ControllerRuntimeHost').ControllerRuntimeHost
    await host.pause()
    expect(calls).toEqual([])
    await host.resume()
    await host.whenReady()
    expect(calls).toEqual(['start', 'resume'])
    await host.pause()
    await host.resume()
    expect(calls).toEqual(['start', 'resume', 'resume'])
  })

  it('keeps startup single while it completes during pause and resumes with a fresh context', async () => {
    const store = owner()
    let complete!: () => void
    let initial!: ControllerContext
    const resume = vi.fn((context: ControllerContext) => context.publish({ value: 5 }))
    const start = vi.fn((context: ControllerContext) => {
      initial = context
      return new Promise<void>((resolve) => {
        complete = resolve
      })
    })
    register(definition(), () => ({ start, resume, command() {} }))
    const pending = Endge.runtime.controllers.mount('test.counter', { owner: store })
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1))
    const host = Endge.runtime.getRuntimeHostsByEntity('controller', 'test.counter')[0] as import('@/features/core/modules/runtime/hosts/ControllerRuntimeHost').ControllerRuntimeHost
    await host.pause()
    complete()
    await pending
    initial.publish({ value: 900 })
    expect(host.getOutput('value')).toBeUndefined()
    await host.resume()
    expect(start).toHaveBeenCalledTimes(1)
    expect(resume).toHaveBeenCalledTimes(1)
    expect(host.getOutput('value')).toBe(5)
  })

  it('starts the built-in window with fresh Store capabilities after pause before startup', async () => {
    const store = owner()
    query()
    const pending = mountWindow(store)
    const host = Endge.runtime.getRuntimeHostsByEntity('controller', 'endge.collection-window')[0] as import('@/features/core/modules/runtime/hosts/ControllerRuntimeHost').ControllerRuntimeHost
    await host.pause()
    await host.resume()
    expect(await pending).toBe(host)
    expect(host.getOutput('rows')).toEqual([])
    expect(host.getOutput('error')).toBeNull()
  })

  it('rejects non-serializable definitions and provider disposal while active', async () => {
    const store = owner()
    const value = definition('test.serializable')
    expect(() => Endge.runtime.controllers.define({
      ...value,
      bad: () => {},
    } as ControllerDefinition)).toThrow()
    const removeDefinition = Endge.runtime.controllers.define(value)
    const removeProvider = Endge.runtime.controllers.provide({
      identity: value.identity,
      key: value.defaultProviderKey,
      create: () => ({
        command() {},
      }),
    })
    const host = await Endge.runtime.controllers.mount(value.identity, {
      owner: store,
    })
    expect(removeDefinition).toThrow('in-use')
    expect(removeProvider).toThrow('in-use')
    await host.dispose()
    expect(Endge.runtime.getRuntimeById(host.id)).toBeNull()
    removeProvider()
    removeDefinition()
  })
  it('blocks old dependency capabilities after pause and input changes even when provider ignores cancellation', async () => {
    const store = owner()
    query()
    const contexts: ControllerContext[] = []
    const value = definition('test.dependencies')
    value.contract.dependencies = {
      state: {
        kind: 'store',
      },
      load: {
        kind: 'query',
      },
    }
    register(value, (context) => {
      contexts.push(context)
      return {
        command() {},
        resume(ctx) {
          contexts.push(ctx)
        },
        setProps(_props, ctx) {
          contexts.push(ctx)
        },
      }
    })
    const host = await Endge.runtime.controllers.mount(value.identity, {
      owner: store,
      dependencies: {
        state: {
          store,
          path: 'window',
          update: 'commit-window',
        },
        load: {
          query: 'load-page',
          output: 'page',
        },
      },
    })
    const old = contexts[0]
    await host.pause()
    await host.resume()
    if (old.dependencies.state.kind !== 'store' || old.dependencies.load.kind !== 'query') {
      throw new Error('fixture')
    }
    expect(() => old.dependencies.state.kind === 'store' && old.dependencies.state.commit({
      revision: 1,
      rowsRevision: 1,
      blocks: [],
    }, 0)).toThrow('superseded')
    await expect(old.dependencies.load.run({}, new AbortController().signal)).rejects.toThrow('superseded')
    const previous = contexts.at(-1)!
    await host.setProps({
      value: 9,
    })
    expect(previous.signal.aborted).toBe(true)
  })
  it('compiles controller dependencies and event command syntax', () => {
    const result = compileCompositionSource(`defineComposition({data:{orders:store('test-update-store')},runtimes:{window:controller('endge.collection-window').withDependencies({state:{store:data('orders'),path:'window',update:'commit-window'},load:{query:'load-page',output:'page'}}),screen:component('screen')},hooks:[onEvent('screen','viewportChanged').command('window','setViewport',event())]})`)
    expect(result.diagnostics).toEqual([])
    expect(result.artifact?.runtimes[0].controllerDependencies?.state).toEqual({
      store: 'orders',
      path: 'window',
      update: 'commit-window',
    })
    expect(result.artifact?.hooks[0]).toMatchObject({
      effect: {
        kind: 'controller-command',
        runtime: 'window',
        command: 'setViewport',
      },
    })
  })
  it('links window Store/Update/Query dependencies and compiles a Table viewport command', async () => {
    const store = owner()
    query()
    vi.spyOn(Endge.runtime.query, 'executeArtifact').mockResolvedValue(page(0))
    const screen = Object.assign(new RComponentSFC(), {
      id: 930,
      identity: 'window-screen',
      source: `<script setup lang="ts">const ports = definePorts({emits:{viewportChanged:event<TableViewportChangedEvent>({from:{ref:'table',event:'viewportChanged'}})}})</script><template><Table ref="table" /></template>`,
    })
    Endge.domain.addComponentSFC(screen)
    const screenArtifact = Endge.compiler.buildComponentSFC(screen)
    expect(screenArtifact.status, JSON.stringify(screenArtifact.diagnostics)).not.toBe('error')
    const composition = Object.assign(new RComposition(), {
      id: 931,
      identity: 'window-composition',
      source: `defineComposition({data:{orders:store('test-update-store')},runtimes:{window:controller('endge.collection-window').withProps({paging:'offset'}).withDependencies({state:{store:data('orders'),path:'window',update:'commit-window'},load:{query:'load-page',output:'page'}}),screen:component('window-screen')},hooks:[onEvent('screen','viewportChanged').command('window','setViewport',event())],outputs:{rows:output().fromRuntime('window').select('rows')}})`,
    })
    Endge.domain.addComposition(composition)
    const artifact = Endge.compiler.buildComposition(composition)
    expect(artifact.status, JSON.stringify(artifact.diagnostics)).not.toBe('error')
    const parse = vi.spyOn(Endge.source, 'compile').mockImplementation(() => {
      throw new Error('runtime must not compile Source')
    })
    const host = Endge.runtime.execute(composition, {
      parent: store,
    }) as import('@/features/core/modules/runtime/hosts/CompositionRuntimeHost').CompositionRuntimeHost
    await host.mountGraph()
    await vi.waitFor(() => expect(host.getOutput('rows')).toHaveLength(10))
    expect(parse).not.toHaveBeenCalled()
  })
  it('exports controller definitions/requirements and imports old/new bundles', () => {
    register(definition('test.bundle'), () => ({
      command() {},
    }))
    const composition = Object.assign(new RComposition(), {
      id: 940,
      identity: 'bundle-controller',
      source: `defineComposition({runtimes:{counter:controller('test.bundle')}})`,
    })
    Endge.domain.addComposition(composition)
    Endge.compiler.build({} as never)
    const bundle = Endge.program.exportBundle()
    expect(bundle.requirements.hostControllers).toContainEqual({
      identity: 'test.bundle',
      providerKey: 'test.bundle',
    })
    expect(bundle.artifacts['controller:test.bundle'].payload).toMatchObject({
      definition: {
        identity: 'test.bundle',
      },
    })
    expect(JSON.stringify(bundle)).not.toContain('create(context)')
    expect(Endge.program.prepareInstall(bundle).bundle.requirements.hostControllers).toEqual(bundle.requirements.hostControllers)
    const legacy = structuredClone(bundle)
    delete legacy.requirements.hostControllers
    expect(Endge.program.prepareInstall(legacy).bundle.version).toBe(1)
  })
  it('links Composition output and mounts the same registered controller', async () => {
    const store = owner()
    register(definition(), () => ({
      start(ctx) {
        ctx.publish({
          value: 42,
        })
      },
      command() {},
    }))
    const model = Object.assign(new RComposition(), {
      id: 910,
      identity: 'controller-composition',
      source: `defineComposition({runtimes:{count:controller('test.counter')},outputs:{value:output().fromRuntime('count').select('value')}})`,
    })
    Endge.domain.addComposition(model)
    const artifact = Endge.compiler.buildComposition(model)
    expect(artifact.status, JSON.stringify(artifact.diagnostics)).not.toBe('error')
    const host = Endge.runtime.execute(model, {
      parent: store,
    }) as import('@/features/core/modules/runtime/hosts/CompositionRuntimeHost').CompositionRuntimeHost
    await host.mountGraph()
    expect(host.getOutput('value')).toBe(42)
  })
})
describe('bounded collection window', () => {
  it.each(['cursor', 'offset'])('loads both directions and trims with stable source boundaries (%s)', async (paging) => {
    const store = owner()
    query()
    const execute = vi.spyOn(Endge.runtime.query, 'executeArtifact').mockImplementation(async ({
      props,
    }) => page(paging === 'cursor' ? props.direction === 'before' ? Number(props.cursor) - 10 : Number(props.cursor ?? 0) : Number(props.offset)))
    const host = await mountWindow(store, {
      paging,
    })
    await host.command('loadInitial')
    await host.command('loadAfter')
    await host.command('loadAfter')
    expect(host.getOutput('rows') as unknown[]).toHaveLength(30)
    await host.command('setViewport', viewport(host, 20, 25))
    expect((host.getOutput('rows') as {
      id: string
    }[])[0].id).toBe('10')
    expect(host.getOutput('loadedRowCount')).toBeLessThanOrEqual(20)
    await host.command('loadBefore')
    expect(execute).toHaveBeenCalledTimes(4)
    expect((store.get('window') as {
      revision: number
    }).revision).toBeGreaterThan(3)
  })
  it('deduplicates incoming values but keeps raw offset span', async () => {
    const store = owner()
    query()
    const offsets: number[] = []
    vi.spyOn(Endge.runtime.query, 'executeArtifact').mockImplementation(async ({
      props,
    }) => {
      const offset = Number(props.offset)
      offsets.push(offset)
      const value = page(offset)
      if (offset === 10) {
        value.rows[0] = {
          id: '9',
          value: 999,
        }
      }
      return value
    })
    const host = await mountWindow(store, {
      paging: 'offset',
    })
    await host.command('loadInitial')
    await host.command('loadAfter')
    await host.command('loadAfter')
    expect(offsets).toEqual([0, 10, 20])
    const rows = host.getOutput('rows') as {
      id: string
      value: number
    }[]
    expect(rows.filter(row => row.id === '9')).toEqual([{
      id: '9',
      value: 999,
    }])
    expect(rows).toHaveLength(29)
  })
  it('reserves before reentrant publication, recovers from synchronous loader throw and requires retry', async () => {
    const store = owner()
    query()
    let calls = 0
    vi.spyOn(Endge.runtime.query, 'executeArtifact').mockImplementation(() => {
      if (++calls === 1) {
        throw new Error('offline')
      }
      return Promise.resolve(page(0))
    })
    const host = await mountWindow(store, {
      paging: 'offset',
    })
    const dispose = host.subscribe(() => {
      if (host.getOutput('loading')) {
        void host.command('loadInitial').catch(() => {})
      }
    })
    await host.command('loadInitial')
    expect(calls).toBe(1)
    expect(host.getOutput('error')).toMatchObject({
      message: 'offline',
    })
    await host.command('loadInitial')
    expect(calls).toBe(1)
    await host.command('retry')
    expect(calls).toBe(2)
    expect(host.getOutput('error')).toBeNull()
    dispose()
  })
  it('aborts old query on request input change and rejects late results', async () => {
    const store = owner()
    query()
    let resolve!: (value: unknown) => void
    let signal: AbortSignal | undefined
    const execute = vi.spyOn(Endge.runtime.query, 'executeArtifact').mockImplementationOnce(({
      signal: current,
    }) => {
      signal = current
      return new Promise((done) => {
        resolve = done
      })
    }).mockResolvedValue(page(50))
    const host = await mountWindow(store, {
      paging: 'offset',
    })
    const pending = host.command('loadInitial')
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    await host.setProps({
      request: {
        status: 'new',
      },
      autoLoad: true,
      initialOffset: 50,
    })
    expect(signal?.aborted).toBe(true)
    expect(host.getOutput('error')).toBeNull()
    resolve(page(0))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect((host.getOutput('rows') as {
      id: string
    }[])[0].id).toBe('50')
  })
  it('retains a contiguous protected span, releases it, and rejects a second writer', async () => {
    const store = owner()
    query()
    vi.spyOn(Endge.runtime.query, 'executeArtifact').mockImplementation(async ({
      props,
    }) => page(Number(props.offset)))
    const host = await mountWindow(store, {
      paging: 'offset',
    })
    await expect(mountWindow(store)).rejects.toThrow('already-owned')
    await host.command('loadInitial')
    await host.command('retainRows', ['0'])
    await host.command('loadAfter')
    await host.command('loadAfter')
    await host.command('setViewport', viewport(host, 20, 25))
    expect(host.getOutput('loadedRowCount')).toBe(30)
    expect(host.getOutput('overLimit')).toBe(true)
    await host.command('releaseRows', ['0'])
    expect(host.getOutput('loadedRowCount')).toBe(20)
  })
  it('rejects empty cursors, missing continuation and no progress', async () => {
    const store = owner()
    query()
    const execute = vi.spyOn(Endge.runtime.query, 'executeArtifact').mockResolvedValue({
      ...page(0),
      endCursor: '',
    })
    const host = await mountWindow(store)
    await host.command('loadInitial')
    expect(host.getOutput('error')).toMatchObject({
      message: 'window-cursor-required',
    })
    execute.mockResolvedValue(page(0))
    await host.command('retry')
    execute.mockResolvedValue(page(0))
    await host.command('loadAfter')
    expect(host.getOutput('error')).toMatchObject({
      message: 'window-no-progress',
    })
  })
})

describe('window demand and cleanup boundaries', () => {
  it('coalesces rapid viewport events and ignores a stale revision', async () => {
    const store = owner()
    query()
    let resolve!: (value: unknown) => void
    const execute = vi.spyOn(Endge.runtime.query, 'executeArtifact').mockResolvedValueOnce(page(0)).mockImplementationOnce(() => new Promise((done) => {
      resolve = done
    }))
    const host = await mountWindow(store, { paging: 'offset' })
    await host.command('loadInitial')
    const stale = viewport(host, 5, 9)
    const pending = host.command('setViewport', stale)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
    await host.command('setViewport', viewport(host, 0, 2))
    await host.command('setViewport', viewport(host, 1, 3))
    resolve(page(10))
    await pending
    expect(execute).toHaveBeenCalledTimes(2)
    await host.command('setViewport', stale)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(host.getOutput('rowsRevision')).not.toBe(stale.rowsRevision)
  })

  it('keeps the protected buffer above a tiny target without a trim/refetch loop', async () => {
    const store = owner()
    query()
    const execute = vi.spyOn(Endge.runtime.query, 'executeArtifact').mockImplementation(async ({ props }) => page(Number(props.offset)))
    const host = await mountWindow(store, { paging: 'offset', maxLoadedRows: 1, prefetchRows: 30 })
    await host.command('loadInitial')
    for (let i = 0; i < 12; i++) {
      await host.command('setViewport', viewport(host, 0, 4))
    }
    expect(execute).toHaveBeenCalledTimes(4)
    expect(host.getOutput('loadedRowCount')).toBe(40)
    expect(host.getOutput('overLimit')).toBe(true)
  })

  it('accepts an empty terminal response and diagnoses missing continuation', async () => {
    const store = owner()
    query()
    const execute = vi.spyOn(Endge.runtime.query, 'executeArtifact').mockResolvedValue({ rows: [], offset: 0, total: 0 })
    const host = await mountWindow(store, { paging: 'offset' })
    await host.command('loadInitial')
    await host.command('loadAfter')
    expect(host.getOutput('rows')).toEqual([])
    expect(host.getOutput('hasAfter')).toBe(false)
    expect(execute).toHaveBeenCalledTimes(1)
    execute.mockResolvedValue({ rows: [{ id: '0' }], offset: 0 })
    await host.command('loadInitial')
    expect(host.getOutput('error')).toMatchObject({ message: 'window-continuation-required' })
  })

  it.each([
    ['cursor', 'before'],
    ['cursor', 'after'],
    ['offset', 'before'],
    ['offset', 'after'],
  ])('closes an empty terminal edge without empty blocks or repeat demand (%s %s)', async (paging, direction) => {
    const store = owner()
    query()
    const execute = vi.spyOn(Endge.runtime.query, 'executeArtifact').mockResolvedValueOnce(page(10)).mockResolvedValue(
      direction === 'after' ? page(20, 0, 20) : page(0, 0),
    )
    const host = await mountWindow(store, { paging, initialOffset: 10, maxLoadedRows: 1, prefetchRows: 1 })
    await host.command('loadInitial')
    const rows = host.getOutput('rows')
    const initialBlocks = (store.get('window') as { blocks: unknown[] }).blocks
    await host.command(direction === 'before' ? 'loadBefore' : 'loadAfter')
    expect(host.getOutput('error')).toBeNull()
    expect(host.getOutput('rows')).toEqual(rows)
    expect(host.getOutput(direction === 'before' ? 'hasBefore' : 'hasAfter')).toBe(false)
    expect((store.get('window') as { blocks: unknown[] }).blocks).toEqual(initialBlocks.map(block => ({ ...block as Record<string, unknown>, [direction === 'before' ? 'hasBefore' : 'hasAfter']: false })))
    for (let i = 0; i < 8; i++) {
      await host.command('setViewport', direction === 'before' ? viewport(host, 0, 1) : viewport(host, 8, 9))
      await host.command(direction === 'before' ? 'loadBefore' : 'loadAfter')
    }
    expect(execute).toHaveBeenCalledTimes(2)
    expect(host.getOutput('rows')).toEqual(rows)
  })

  it.each([['cursor', 'before'], ['cursor', 'after'], ['offset', 'before'], ['offset', 'after']])('closes an all-duplicate terminal edge under tiny-target trim (%s %s)', async (paging, direction) => {
    const store = owner()
    query()
    const terminal = {
      ...page(direction === 'before' ? 0 : 20),
      rows: page(10).rows.map(row => ({ ...row, value: row.value + 1000 })),
      hasBefore: direction !== 'before',
      hasAfter: direction !== 'after',
      startCursor: 'terminal-start',
      endCursor: 'terminal-end',
    }
    const execute = vi.spyOn(Endge.runtime.query, 'executeArtifact').mockResolvedValueOnce(page(10)).mockResolvedValue(terminal)
    const host = await mountWindow(store, { paging, initialOffset: 10, maxLoadedRows: 1, prefetchRows: 1 })
    await host.command('loadInitial')
    const initialBlocks = (store.get('window') as { blocks: unknown[] }).blocks
    // This preserves the loaded span while the incoming block has zero NEW rows.
    await host.command('setViewport', viewport(host, 2, 7))
    await host.command(direction === 'before' ? 'loadBefore' : 'loadAfter')
    expect(host.getOutput('error')).toBeNull()
    expect(host.getOutput('rows')).toEqual(terminal.rows)
    expect(host.getOutput(direction === 'before' ? 'hasBefore' : 'hasAfter')).toBe(false)
    expect((store.get('window') as { blocks: unknown[] }).blocks).toEqual(initialBlocks.map(block => ({
      ...block as Record<string, unknown>,
      rows: terminal.rows,
      [direction === 'before' ? 'hasBefore' : 'hasAfter']: false,
    })))
    for (let i = 0; i < 8; i++) {
      await host.command('setViewport', direction === 'before' ? viewport(host, 0, 1) : viewport(host, 8, 9))
      await host.command(direction === 'before' ? 'loadBefore' : 'loadAfter')
    }
    expect(execute).toHaveBeenCalledTimes(2)
    expect(host.getOutput('rows')).toEqual(terminal.rows)
  })

  it.each([['cursor', 'before'], ['cursor', 'after'], ['offset', 'before'], ['offset', 'after']])('rejects an empty response still claiming requested continuation (%s %s)', async (paging, direction) => {
    const store = owner()
    query()
    vi.spyOn(Endge.runtime.query, 'executeArtifact').mockResolvedValueOnce(page(10)).mockResolvedValue({ ...page(direction === 'before' ? 0 : 20, 0), hasBefore: true, hasAfter: true })
    const host = await mountWindow(store, { paging, initialOffset: 10 })
    await host.command('loadInitial')
    await host.command(direction === 'before' ? 'loadBefore' : 'loadAfter')
    expect(host.getOutput('error')).toMatchObject({ message: 'window-no-progress' })
    expect(host.getOutput('rows')).toHaveLength(10)
  })

  it('loads a partial preceding offset block near zero', async () => {
    const store = owner()
    query()
    const execute = vi.spyOn(Endge.runtime.query, 'executeArtifact').mockImplementation(async ({ props }) => page(Number(props.offset), Number(props.limit)))
    const host = await mountWindow(store, { paging: 'offset', initialOffset: 4 })
    await host.command('loadInitial')
    await host.command('loadBefore')
    expect(execute.mock.calls[1][0].props).toMatchObject({ offset: 0, limit: 4, direction: 'before' })
    expect(host.getOutput('hasBefore')).toBe(false)
    expect((host.getOutput('rows') as { id: string }[])[0].id).toBe('0')
  })

  it('diagnoses a skipped guarded Update instead of publishing uncommitted data', async () => {
    const store = createUpdateStoreRuntime({ storeSource: 'defineStore({data:{window:value({revision:0,rowsRevision:0,blocks:[]})}})', updates: [{ identity: 'commit-window', source: `defineUpdate({mutations:[{strategy:'set',target:'window',value:input('next'),when:eq(input('expectedRevision'),99)}]})` }] })
    query()
    vi.spyOn(Endge.runtime.query, 'executeArtifact').mockResolvedValue(page(0))
    const host = await mountWindow(store, { paging: 'offset' })
    await host.command('loadInitial')
    expect(host.getOutput('error')).toMatchObject({ message: 'controller-state-commit-rejected' })
    expect(host.getOutput('rows')).toEqual([])
    expect((store.get('window') as { revision: number }).revision).toBe(0)
  })

  it.each(['factory', 'start'])('releases failed %s instances and provider leases', async (stage) => {
    const store = owner()
    const value = definition(`test.failure-${stage}`)
    const removeDefinition = Endge.runtime.controllers.define(value)
    const removeProvider = Endge.runtime.controllers.provide({ identity: value.identity, key: value.defaultProviderKey, create: () => {
      if (stage === 'factory') {
        throw new Error('factory failure')
      }
      return {
        command() {},
        start() {
          throw new Error('start failure')
        },
      }
    } })
    await expect(Endge.runtime.controllers.mount(value.identity, { owner: store })).rejects.toThrow(`${stage} failure`)
    expect(Endge.runtime.getRuntimeHostsByEntity('controller', value.identity)).toHaveLength(0)
    expect(removeProvider).not.toThrow()
    expect(removeDefinition).not.toThrow()
  })
})

it('restarts an interrupted load with new policy inputs without losing initial demand', async () => {
  const store = owner()
  query()
  let resolve!: (value: unknown) => void
  const execute = vi.spyOn(Endge.runtime.query, 'executeArtifact').mockImplementationOnce(() => new Promise((done) => {
    resolve = done
  })).mockImplementation(async ({ props }) => page(0, Number(props.limit)))
  const host = await mountWindow(store, { paging: 'offset' })
  const pending = host.command('loadInitial')
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
  await host.setProps({ batchSize: 5 })
  expect(host.getOutput('loadedRowCount')).toBe(5)
  resolve(page(0))
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(host.getOutput('loadedRowCount')).toBe(5)
  expect(execute).toHaveBeenCalledTimes(2)
})

it('keeps actual Store capabilities private and snapshots current props as serializable metadata', async () => {
  const store = owner()
  query()
  const host = await mountWindow(store, { paging: 'offset' })
  await host.setProps({ maxLoadedRows: 25 })
  const snapshot = host.snapshot()
  expect(snapshot.meta.controllerDependencies).toMatchObject({ state: { kind: 'store', storeRuntimeId: store.id, path: 'window', update: 'commit-window' }, load: { kind: 'query', query: 'load-page', output: 'page' } })
  expect(snapshot.meta.props).toMatchObject({ maxLoadedRows: 25 })
  expect(() => JSON.stringify(snapshot)).not.toThrow()
  expect(() => JSON.stringify(Endge.runtime.snapshot())).not.toThrow()
  const capture = Endge.runtime.captureInspection(true)
  expect(capture.runtime.hosts.find(item => item.id === host.id)?.meta.props).toMatchObject({ maxLoadedRows: 25 })
  expect(JSON.stringify(capture)).not.toContain('[Circular]')
})

describe('page cache Source and SDK integration', () => {
  it('caches the normalized Query output through SDK without sharing Query ownership', async () => {
    const store = owner()
    query()
    const execute = vi.spyOn(Endge.runtime.query, 'executeArtifact').mockResolvedValue(page(0))
    const host = await Endge.runtime.controllers.mount('endge.collection-window', {
      owner: store,
      props: { paging: 'offset', autoLoad: false },
      dependencies: {
        state: { store, path: 'window', update: 'commit-window' },
        load: { query: 'load-page', output: 'page', cache: { key: 'sdk-pages', storage: 'memory' } },
      },
    })
    await host.command('loadInitial')
    await vi.waitFor(() => expect((host.getOutput('cacheStatus') as { entries: number }).entries).toBe(1))
    await host.command('reset')
    await host.command('loadInitial')
    expect(execute).toHaveBeenCalledTimes(1)
    expect((host.getOutput('cacheStatus') as { source: string }).source).toBe('memory')
    await host.command('refresh')
    expect(execute).toHaveBeenCalledTimes(2)
    await host.dispose()
  })
  it('compiles cache configuration including numeric byte expressions and rejects typos', () => {
    const source = (cache: string) => `defineComposition({data:{orders:store('test-update-store')},runtimes:{window:controller('endge.collection-window').withProps({retention:{beforeRows:200,afterRows:400}}).withDependencies({state:{store:data('orders'),path:'window',update:'commit-window'},load:{query:'load-page',output:'page',cache:${cache}}})}})`
    const compiled = compileCompositionSource(source('{key:\'orders\',storage:\'indexeddb\',maxBytes:50*1024*1024}'))
    expect(compiled.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    const load = compiled.document!.runtimes[0].controllerDependencies!.load
    expect('query' in load && load.cache?.maxBytes).toBe(52428800)
    const invalid = compileCompositionSource(source('{key:\'orders\',storage:\'indexeddb\',maxEntrys:3}'))
    expect(invalid.diagnostics.some(d => d.code === 'composition-controller-cache')).toBe(true)
  })
})

it('round-trips retention/cache requirements and runs the installed graph without Source', async () => {
  const parent = owner()
  query()
  const execute = vi.spyOn(Endge.runtime.query, 'executeArtifact').mockResolvedValue({ ...page(0), rows: page(0).rows.map(row => ({ ...row, marker: 'runtime-page-only' })) })
  const model = Object.assign(new RComposition(), {
    id: 990,
    identity: 'cached-bundle-window',
    source: `defineComposition({data:{orders:store('test-update-store').isolated()},runtimes:{window:controller('endge.collection-window').withProps({paging:'offset',autoLoad:false,prefetchRows:0,retention:{beforeRows:100,afterRows:200}}).withDependencies({state:{store:data('orders'),path:'window',update:'commit-window'},load:{query:'load-page',output:'page',cache:{key:'portable-pages',storage:'memory',strategy:'stale-while-revalidate',maxStaleMs:600000}}})}})`,
  })
  Endge.domain.addComposition(model)
  Endge.compiler.build({} as never)
  expect(Endge.program.getDiagnostics().filter(item => item.severity === 'error')).toEqual([])
  const first = Endge.runtime.execute(model, { parent }) as import('@/features/core/modules/runtime/hosts/CompositionRuntimeHost').CompositionRuntimeHost
  await first.mountGraph()
  await (first.getChild('window') as import('@/features/core/modules/runtime/hosts/ControllerRuntimeHost').ControllerRuntimeHost).command('loadInitial')
  const bundle = Endge.program.exportBundle()
  expect(bundle.requirements.controllerFeatures).toEqual(['retention-v1', 'page-cache-v1'])
  expect(JSON.stringify(bundle)).not.toContain('runtime-page-only')
  const invalid = structuredClone(bundle)
  ;(invalid.requirements.controllerFeatures as string[]).push('future-cache-v9')
  expect(() => Endge.program.prepareInstall(invalid)).toThrow('Unsupported controller feature requirement')
  await Endge.runtime.destroyRuntimeTreeAsync(first.id)
  Endge.program.installBundle(Endge.program.prepareInstall(bundle))
  model.source = 'Source deliberately unavailable'
  const compile = vi.spyOn(Endge.source, 'compile').mockImplementation(() => {
    throw new Error('Source must not be read')
  })
  const second = Endge.runtime.execute(model, { parent }) as import('@/features/core/modules/runtime/hosts/CompositionRuntimeHost').CompositionRuntimeHost
  await second.mountGraph()
  const window = second.getChild('window') as import('@/features/core/modules/runtime/hosts/ControllerRuntimeHost').ControllerRuntimeHost
  await window.command('loadInitial')
  expect(window.getOutput('loadedRowCount')).toBe(10)
  expect((window.getOutput('cacheStatus') as { source: string }).source).toBe('memory')
  expect(execute).toHaveBeenCalledTimes(1)
  expect(compile).not.toHaveBeenCalled()
})

it('isolates authenticated users and cancels a late Query on execution context change', async () => {
  const store = owner()
  query()
  Endge.context.setSessionIdentityProvider({ getCurrentIdentity: () => ({ userId: 'user-a' }) })
  let complete!: (value: unknown) => void
  let signal: AbortSignal | undefined
  const execute = vi.spyOn(Endge.runtime.query, 'executeArtifact').mockResolvedValue(page(0))
  const mount = () => Endge.runtime.controllers.mount('endge.collection-window', {
    owner: store,
    props: { paging: 'offset', autoLoad: false },
    dependencies: { state: { store, path: 'window', update: 'commit-window' }, load: { query: 'load-page', output: 'page', cache: { key: 'authenticated-pages', storage: 'memory' } } },
  })
  const first = await mount()
  await first.command('loadInitial')
  expect(first.getOutput('error')).toBe(null)
  execute.mockImplementationOnce((input) => {
    signal = input.signal
    return new Promise((resolve) => {
      complete = resolve
    })
  })
  const pending = first.command('loadAfter').catch(error => error)
  await vi.waitFor(() => expect(signal).toBeDefined())
  Endge.context.setSessionIdentityProvider({ getCurrentIdentity: () => ({ userId: 'user-b' }) })
  expect(signal!.aborted).toBe(true)
  complete(page(100))
  expect(await pending).toMatchObject({ name: 'AbortError' })
  expect(first.getOutput('loadedRowCount')).toBe(10)
  expect(first.status).toBe('paused')
  await expect(first.resume()).rejects.toMatchObject({ name: 'AbortError' })
  await first.dispose()
  const second = await mount()
  await second.command('loadInitial')
  expect(execute).toHaveBeenCalledTimes(3)
  expect((second.getOutput('cacheStatus') as { source: string }).source).toBe('network')
  await second.dispose()
  Endge.context.setSessionIdentityProvider({ getCurrentIdentity: () => ({ userId: 'user-a' }) })
  const third = await mount()
  await third.command('loadInitial')
  expect(execute).toHaveBeenCalledTimes(3)
  expect((third.getOutput('cacheStatus') as { source: string }).source).toBe('memory')
  await third.dispose()
  Endge.context.setSessionIdentityProvider(null)
})

it('does not serve a live cached page inside an explicit mock Composition', async () => {
  const store = owner()
  query()
  const execute = vi.spyOn(Endge.runtime.query, 'executeArtifact').mockResolvedValue(page(0))
  for (const mode of ['live', 'mock'] as const) {
    const model = Object.assign(new RComposition(), { id: `cache-mode-${mode}`, identity: `cache-mode-${mode}`, source: `defineComposition({dataMode:'${mode}',runtimes:{}})` })
    Endge.domain.addComposition(model)
    expect(Endge.compiler.buildComposition(model).status).toBe('valid')
    const session = await Endge.runtime.composition.mount(model.identity)
    const host = await Endge.runtime.controllers.mount('endge.collection-window', {
      owner: session.host,
      props: { paging: 'offset', autoLoad: false },
      dependencies: { state: { store, path: 'window', update: 'commit-window' }, load: { query: 'load-page', output: 'page', cache: { key: 'mode-pages', storage: 'memory' } } },
    })
    await host.command('loadInitial')
    expect(execute).toHaveBeenCalledTimes(1)
    if (mode === 'mock') {
      expect(host.getOutput('error')).toMatchObject({ message: 'window-response-invalid' })
      expect((host.getOutput('cacheStatus') as { hits: number }).hits).toBe(0)
    }
    else {
      expect(host.getOutput('error')).toBe(null)
    }
    await session.unmount()
  }
})

it('executes a legacy builtin window definition with its original eight outputs', async () => {
  const parent = owner()
  query()
  vi.spyOn(Endge.runtime.query, 'executeArtifact').mockImplementation(async input => page(Number(input.props.offset ?? 0)))
  const model = Object.assign(new RComposition(), { id: 995, identity: 'legacy-window', source: `defineComposition({data:{orders:store('test-update-store').isolated()},runtimes:{window:controller('endge.collection-window').withProps({paging:'offset',autoLoad:false}).withDependencies({state:{store:data('orders'),path:'window',update:'commit-window'},load:{query:'load-page',output:'page'}})}})` })
  Endge.domain.addComposition(model)
  Endge.compiler.build({} as never)
  const bundle = Endge.program.exportBundle()
  const definition = (bundle.artifacts['controller:endge.collection-window'].payload as unknown as { definition: ControllerDefinition }).definition
  definition.contract.props = definition.contract.props.filter(field => field.key !== 'retention')
  definition.contract.outputs = definition.contract.outputs.filter(field => !['refreshPending', 'cacheStatus'].includes(field.key))
  delete definition.contract.commands.refresh
  delete definition.contract.commands.clearCache
  expect(definition.contract.outputs).toHaveLength(8)
  Endge.program.installBundle(Endge.program.prepareInstall(bundle))
  const compile = vi.spyOn(Endge.source, 'compile').mockImplementation(() => {
    throw new Error('Legacy bundle must not read Source')
  })
  const graph = Endge.runtime.execute(model, { parent }) as import('@/features/core/modules/runtime/hosts/CompositionRuntimeHost').CompositionRuntimeHost
  await graph.mountGraph()
  const controller = graph.getChild('window') as import('@/features/core/modules/runtime/hosts/ControllerRuntimeHost').ControllerRuntimeHost
  await controller.command('loadInitial')
  expect(controller.getOutput('loadedRowCount')).toBe(10)
  expect(Object.keys(controller.getOutputs())).toHaveLength(8)
  await controller.pause()
  await controller.resume()
  await controller.command('loadAfter')
  expect(controller.getOutput('loadedRowCount')).toBe(20)
  await expect(controller.command('refresh')).rejects.toThrow('controller-command-missing')
  expect(compile).not.toHaveBeenCalled()
})

it('invalidates cached normalized pages when an output dependency changes without changing Query Source', async () => {
  const store = owner()
  query()
  const original = Endge.program.getQueryArtifact('load-page')!
  let version = 1
  const execute = vi.spyOn(Endge.runtime.query, 'executeArtifact').mockImplementation(async () => ({ ...page(0), rows: page(0).rows.map(row => ({ ...row, version })) }))
  const install = () => {
    Endge.program.addArtifact({ ...structuredClone(original), ref: { entityType: 'data-view', id: 'page-codec', identity: 'page-codec' }, sourceHash: `codec-${version}`, dependencies: [], payload: {} }, () => true)
    Endge.program.addArtifact({ ...structuredClone(original), dependencies: [...original.dependencies, { entityType: 'data-view', id: 'page-codec', identity: 'page-codec', role: 'output-data-view' }] }, () => true)
  }
  const mount = () => Endge.runtime.controllers.mount('endge.collection-window', {
    owner: store,
    props: { paging: 'offset', autoLoad: false },
    dependencies: { state: { store, path: 'window', update: 'commit-window' }, load: { query: 'load-page', output: 'page', cache: { key: 'compiled-output-version', storage: 'memory' } } },
  })
  install()
  const first = await mount()
  await first.command('loadInitial')
  await first.dispose()
  version = 2
  install()
  expect(Endge.program.getQueryArtifact('load-page')!.sourceHash).toBe(original.sourceHash)
  expect(Endge.program.getQueryArtifact('load-page')!.contextHash).toBe(original.contextHash)
  const second = await mount()
  await second.command('reset')
  await second.command('loadInitial')
  expect(second.getOutput('error')).toBe(null)
  expect(execute).toHaveBeenCalledTimes(2)
  expect((second.getOutput('rows') as Array<{ version: number }>)[0].version).toBe(2)
  await second.dispose()
})
