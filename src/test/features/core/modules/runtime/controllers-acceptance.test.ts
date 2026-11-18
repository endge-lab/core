import type { ControllerDefinition } from '@/features/core/modules/runtime/domain/controllers/controller.types'
import type { ControllerRuntimeHost } from '@/features/core/modules/runtime/hosts/ControllerRuntimeHost'
import { Raph } from '@raphy-js/raph'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { EndgeBundleCodec_Service } from '@/features/core/kernel/services/EndgeBundleCodec_Service'
import { RComponentSFC } from '@/features/core/modules/domain/entities/RComponentSFC'
import { RComposition } from '@/features/core/modules/domain/entities/RComposition'
import { RQuery } from '@/features/core/modules/domain/entities/RQuery'
import { RStore } from '@/features/core/modules/domain/entities/RStore'
import { RUpdate } from '@/features/core/modules/domain/entities/RUpdate'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'
import { prepareTestCompilerContext, resetTestCompilerContext } from '@/test/helpers/compiler-context'

// Select Axios's real browser Fetch adapter for this Node test file. The only
// stubbed execution boundary is fetch; Query/host/output/Update code stays real.
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>()
  return {
    ...actual,
    default: {
      ...actual.default,
      create: (config: import('axios').CreateAxiosDefaults) => actual.default.create({ ...config, adapter: 'fetch' }),
    },
  }
})

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
  vi.unstubAllGlobals()
})

function counterDefinition(identity = 'accept.counter'): ControllerDefinition {
  return {
    identity,
    displayName: 'Acceptance counter',
    origin: { kind: 'local', owner: 'endge-example' },
    defaultProviderKey: `${identity}.default`,
    contract: {
      props: [{ key: 'value', type: 'Number', array: false, optional: false }],
      outputs: [{ key: 'value', type: 'Number', array: false, optional: false }],
      commands: { update: {} },
      dependencies: {},
    },
  }
}
function registerCounter(identity = 'accept.counter') {
  const definition = counterDefinition(identity)
  removers.push(Endge.runtime.controllers.define(definition))
  const removeProvider = Endge.runtime.controllers.provide({
    identity,
    key: definition.defaultProviderKey,
    create: () => ({
      start: context => context.publish({ value: context.props.value }),
      command() {},
    }),
  })
  removers.push(removeProvider)
  return removeProvider
}
const stateBinding = 'state:{store:data(\'orders\'),path:\'window\',update:\'accept-commit\'}'
const loadBinding = 'load:{query:\'accept-page\',output:\'page\'}'
const windowRuntime = `controller('endge.collection-window').withProps({paging:'offset',autoLoad:false,batchSize:10}).withDependencies({${stateBinding},${loadBinding}})`

function addStoreAndUpdate(includeDerived = false) {
  const store = Object.assign(new RStore(), {
    id: 'accept-store',
    identity: 'accept-store',
    source: `defineStore({data:{window:value({revision:0,rowsRevision:0,blocks:[]}),other:value([])${includeDerived ? ',derived:derived().from(\'other\').dataView(defineDataView({mode:\'pipeline\',steps:[from(\'\').as(\'row\'),map({...spread(\'row\')})]}))' : ''}}})`,
  })
  const update = Object.assign(new RUpdate(), {
    id: 'accept-commit',
    identity: 'accept-commit',
    storeIdentity: store.identity,
    source: 'defineUpdate({mutations:[{strategy:\'set\',target:\'window\',value:input(\'next\'),when:eq(data(\'window.revision\'),input(\'expectedRevision\'))}]})',
  })
  Endge.domain.addStore(store)
  Endge.domain.addUpdate(update)
  return { store, update }
}
function addQuery(kind: 'rest' | 'graphql' = 'rest') {
  const props = 'props:defineProps({status:field(\'String\').optional(),direction:field(\'String\').optional(),cursor:field(\'String\').optional(),offset:field(\'Number\').optional(),limit:field(\'Number\').optional()})'
  const values = '({prop})=>({status:prop(\'status\'),direction:prop(\'direction\'),cursor:prop(\'cursor\'),offset:prop(\'offset\'),limit:prop(\'limit\')})'
  const request = kind === 'rest'
    ? `endpoint:'https://api.example.test',path:'/rows',method:'POST',auth:{mode:'none'},body:body(${values})`
    : `endpoint:'https://api.example.test/graphql',auth:{mode:'none'},operationName:'WindowPage',document:gql\`query WindowPage($status:String,$direction:String,$cursor:String,$offset:Int,$limit:Int){page(status:$status,direction:$direction,cursor:$cursor,offset:$offset,limit:$limit){rows{id value}offset total}}\`,variables:variables(${values})`
  const query = Object.assign(new RQuery(), {
    id: 'accept-page',
    identity: 'accept-page',
    source: `defineQuery({kind:'${kind}',${props},request:{${request}},outputs:{page:output().from(${kind === 'rest' ? 'response()' : 'data(\'page\')'})}})`,
  })
  Endge.domain.addQuery(query)
  return query
}
function addComposition(source: string, identity = 'accept-app') {
  const model = Object.assign(new RComposition(), { id: identity, identity, source })
  Endge.domain.addComposition(model)
  return model
}
function compileAll() {
  Endge.compiler.build({} as never)
  expect(Endge.program.getDiagnostics().filter(item => item.severity === 'error')).toEqual([])
}
function rows(offset = 0) {
  return { rows: [{ id: String(offset), value: offset }], offset, total: offset + 1 }
}
function reply(kind: 'rest' | 'graphql', offset = 0) {
  return new Response(JSON.stringify(kind === 'rest' ? rows(offset) : { data: { page: rows(offset) } }), { headers: { 'Content-Type': 'application/json' } })
}
function delayedFetch() {
  const requests: Array<{ request: Request, complete: (response: Response) => void }> = []
  const fetch = vi.fn((input: RequestInfo | URL) => new Promise<Response>((complete) => {
    requests.push({ request: input as Request, complete })
  }))
  vi.stubGlobal('fetch', fetch)
  return { fetch, requests }
}

// Domain identities remain installed by the current boot contract; Sources are
// hostile getters after export, proving normal runtime does not reread them.
describe('controller decoded execution bundles', () => {
  it.each([
    ['complete-model', 'json', false],
    ['complete-model', 'gzip', false],
    ['startup-composition', 'json', false],
    ['startup-composition', 'gzip', false],
    ['complete-model', 'json', true],
    ['complete-model', 'gzip', true],
    ['startup-composition', 'json', true],
    ['startup-composition', 'gzip', true],
  ] as const)('executes real Store/Update/Query and code provider after %s %s roundtrip (derived=%s)', async (scope, format, includeDerived) => {
    const { store, update } = addStoreAndUpdate(includeDerived)
    const query = addQuery()
    registerCounter()
    registerCounter('accept.unreachable')
    addComposition('defineComposition({runtimes:{unused:controller(\'accept.unreachable\').withProps({value:9})}})', 'accept-unreachable')
    const app = addComposition(`defineComposition({data:{orders:store('accept-store')},runtimes:{window:${windowRuntime},counter:controller('accept.counter').withProps({value:31})},outputs:{rows:output().fromRuntime('window').select('rows'),value:output().fromRuntime('counter').select('value')}})`)
    Endge.workspace.apply({ ...TEST_ENDGE_WORKSPACE, startupCompositionIdentity: app.identity })
    compileAll()
    const exported = Endge.program.exportBundle({ scope })
    expect(exported.requirements.hostControllers).toContainEqual({ identity: 'endge.collection-window', providerKey: 'endge.collection-window.default' })
    expect(exported.requirements.hostControllers).toContainEqual({ identity: 'accept.counter', providerKey: 'accept.counter.default' })
    expect(exported.requirements.hostControllers?.some(item => item.identity === 'accept.unreachable')).toBe(scope === 'complete-model')
    expect(exported.artifacts['query:accept-page']).toBeTruthy()
    expect(exported.artifacts['update:accept-commit']).toBeTruthy()
    expect(exported.requirements.artifactTypes.includes('data-view')).toBe(includeDerived)
    const codec = new EndgeBundleCodec_Service()
    const decoded = await codec.decode(await codec.encode({ format: 'endge-bundle', version: 1, bundle: JSON.parse(JSON.stringify(exported)) }, format))
    Endge.program.clear()
    Endge.program.installBundle(Endge.program.prepareInstall(decoded.bundle!))
    const compile = vi.spyOn(Endge.source, 'compile').mockImplementation(() => {
      throw new Error('Source compilation is forbidden after import')
    })
    for (const model of [store, update, query, app]) {
      Object.defineProperty(model, 'source', { configurable: true, get() {
        throw new Error('Source reread is forbidden after import')
      } })
    }
    const transport = delayedFetch()
    const session = await Endge.runtime.composition.mount(app.identity)
    expect(session.output('value')).toBe(31)
    const window = session.host.getChild('window') as ControllerRuntimeHost
    const pending = window.command('loadInitial')
    await vi.waitFor(() => expect(transport.fetch).toHaveBeenCalledTimes(1))
    const queryHosts = Endge.runtime.getRuntimeHostsByEntity('query', query.identity)
    expect(queryHosts).toHaveLength(1)
    expect(queryHosts[0].parent?.id).toBe(window.id)
    expect(JSON.parse(await transport.requests[0].request.text())).toMatchObject({ direction: 'initial', offset: 0, limit: 10 })
    transport.requests[0].complete(reply('rest'))
    await pending
    expect(session.output('rows')).toEqual(rows().rows)
    expect(session.host.getDataSnapshot()).toMatchObject({ orders: { window: { revision: 1, rowsRevision: 1, blocks: [{ rows: rows().rows }] } } })
    expect(Endge.runtime.getRuntimeHostsByEntity('query', query.identity)).toHaveLength(0)
    expect(compile).not.toHaveBeenCalled()
    await session.unmount()
    expect(Endge.runtime.getRuntimeHostsByEntity('controller', 'accept.counter')).toHaveLength(0)
    expect(Endge.runtime.getRuntimeHostsByEntity('controller', 'endge.collection-window')).toHaveLength(0)
    expect(Endge.runtime.getRuntimeHostsByEntity('store', store.identity)).toHaveLength(0)
  })

  it.each(['complete-model', 'startup-composition'] as const)('roundtrips a generic Store with an inline derived child without Controllers (%s)', async (scope) => {
    const { store } = addStoreAndUpdate(true)
    const app = addComposition('defineComposition({data:{orders:store(\'accept-store\')},runtimes:{}})')
    Endge.workspace.apply({ ...TEST_ENDGE_WORKSPACE, startupCompositionIdentity: app.identity })
    compileAll()
    expect(Endge.program.getArtifacts().some(item => item.ref.entityType === 'controller')).toBe(false)
    expect(Endge.program.getArtifacts().some(item => item.ref.entityType === 'data-view')).toBe(false)
    expect(Endge.program.getStoreArtifact(store.identity)?.children?.some(item => item.ref.entityType === 'data-view')).toBe(true)
    const bundle = Endge.program.exportBundle({ scope })
    expect(bundle.requirements.artifactTypes).toContain('data-view')
    const codec = new EndgeBundleCodec_Service()
    const decoded = await codec.decode(await codec.encode({ format: 'endge-bundle', version: 1, bundle }, 'json'))
    Endge.program.clear()
    Endge.program.installBundle(Endge.program.prepareInstall(decoded.bundle!))
    vi.spyOn(Endge.source, 'compile').mockImplementation(() => {
      throw new Error('Source compilation is forbidden')
    })
    const session = await Endge.runtime.composition.mount(app.identity)
    expect(session.host.getDataSnapshot()).toMatchObject({ orders: { derived: [] } })
    await session.unmount()
    expect(Endge.runtime.getRuntimeHostsByEntity('store', store.identity)).toHaveLength(0)
  })

  it('reports a missing local provider explicitly after decoded install', async () => {
    const removeProvider = registerCounter()
    const app = addComposition('defineComposition({runtimes:{counter:controller(\'accept.counter\').withProps({value:31})}})')
    compileAll()
    const codec = new EndgeBundleCodec_Service()
    const decoded = await codec.decode(await codec.encode({ format: 'endge-bundle', version: 1, bundle: Endge.program.exportBundle() }, 'json'))
    Endge.program.installBundle(Endge.program.prepareInstall(decoded.bundle!))
    removeProvider()
    removers.pop()
    vi.spyOn(Endge.source, 'compile').mockImplementation(() => {
      throw new Error('Source compilation is forbidden')
    })
    await expect(Endge.runtime.composition.mount(app.identity)).rejects.toThrow('controller-provider-missing: accept.counter')
    expect(Endge.runtime.getRuntimeHostsByEntity('controller', 'accept.counter')).toHaveLength(0)
    expect(Endge.runtime.getRuntimeHostsByEntity('composition', app.identity)).toHaveLength(0)
  })
})

describe('actual compiler Controller negative contracts', () => {
  const bindings = `{${stateBinding},${loadBinding}}`
  const make = (runtime: string, extra = '') => `defineComposition({data:{orders:store('accept-store')},runtimes:{window:${runtime},screen:component('accept-screen')},${extra}})`
  it.each([
    ['definition', make('controller(\'accept.missing\')'), 'controller-definition-missing'],
    ['unknown prop', make('controller(\'accept.counter\').withProps({value:1,unknown:2})'), 'controller-prop-unknown'],
    ['required prop', make('controller(\'accept.counter\')'), 'controller-prop-required'],
    ['missing dependency', make('controller(\'endge.collection-window\')'), 'controller-dependency-required'],
    ['unknown dependency', make(`controller('endge.collection-window').withDependencies({${stateBinding},${loadBinding},extra:{query:'accept-page',output:'page'}})`), 'controller-dependency-unknown'],
    ['wrong dependency kind', make(`controller('endge.collection-window').withDependencies({state:{query:'accept-page',output:'page'},${loadBinding}})`), 'controller-dependency-kind'],
    ['unknown Store alias', make(`controller('endge.collection-window').withDependencies({state:{store:data('absent'),path:'window',update:'accept-commit'},${loadBinding}})`), 'composition-controller-dependency-shape'],
    ['read-only Store path', make(`controller('endge.collection-window').withDependencies({state:{store:data('orders'),path:'derived',update:'accept-commit'},${loadBinding}})`), 'controller-state-update-invalid'],
    ['unknown Store path', make(`controller('endge.collection-window').withDependencies({state:{store:data('orders'),path:'absent',update:'accept-commit'},${loadBinding}})`), 'controller-state-update-invalid'],
    ['wrong Update target', make(`controller('endge.collection-window').withDependencies({state:{store:data('orders'),path:'other',update:'accept-commit'},${loadBinding}})`), 'controller-state-update-invalid'],
    ['unknown Update', make(`controller('endge.collection-window').withDependencies({state:{store:data('orders'),path:'window',update:'absent'},${loadBinding}})`), 'controller-state-update-invalid'],
    ['wrong Update owner', make(`controller('endge.collection-window').withDependencies({state:{store:data('orders'),path:'window',update:'accept-foreign-update'},${loadBinding}})`), 'controller-state-update-invalid'],
    ['unknown Query', make(`controller('endge.collection-window').withDependencies({${stateBinding},load:{query:'absent',output:'page'}})`), 'controller-query-output-missing'],
    ['unknown Query output', make(`controller('endge.collection-window').withDependencies({${stateBinding},load:{query:'accept-page',output:'absent'}})`), 'controller-query-output-missing'],
    ['unknown command', make(`controller('endge.collection-window').withDependencies(${bindings})`, 'hooks:[onEvent(\'screen\',\'changed\').command(\'window\',\'absent\',event())]'), 'controller-command-missing'],
    ['prototype command', make(`controller('endge.collection-window').withDependencies(${bindings})`, 'hooks:[onEvent(\'screen\',\'changed\').command(\'window\',\'toString\',event())]'), 'controller-command-missing'],
    ['unknown output', make('controller(\'accept.counter\').withProps({value:1})', 'outputs:{value:output().fromRuntime(\'window\').select(\'absent\')}'), 'composition-output-selection-missing'],
    ['unknown bound output', 'defineComposition({runtimes:{a:controller(\'accept.counter\').withProps({value:1}),b:controller(\'accept.counter\').withProps({value:fromOutput(\'a\',\'absent\')})}})', 'composition-binding-output-missing'],
    ['duplicate state owner', `defineComposition({data:{orders:store('accept-store')},runtimes:{a:${windowRuntime},b:${windowRuntime}}})`, 'controller-state-already-owned'],
    ['invalid unselected context variant', 'defineComposition({runtimes:{counter:contextSwitch({default:controller(\'accept.counter\'),cases:[{when:{region:\'us\'},use:controller(\'accept.missing\')}] }).withProps({value:1})}})', 'controller-definition-missing'],
    ['Store inside nested scope', `defineComposition({runtimes:{inner:scope({data:{orders:store('accept-store')},runtimes:{window:${windowRuntime}}})}})`, 'composition-scope-store-unsupported'],
  ])('diagnoses %s', (_name, source, code) => {
    addStoreAndUpdate(true)
    addQuery()
    registerCounter()
    const other = Object.assign(new RStore(), { id: 'accept-foreign', identity: 'accept-foreign', source: 'defineStore({data:{window:value({})}})' })
    Endge.domain.addStore(other)
    Endge.domain.addUpdate(Object.assign(new RUpdate(), { id: 'accept-foreign-update', identity: 'accept-foreign-update', storeIdentity: other.identity, source: 'defineUpdate({mutations:[{strategy:\'set\',target:\'window\',value:input(\'next\')}]})' }))
    Endge.domain.addComponentSFC(Object.assign(new RComponentSFC(), { id: 'accept-screen', identity: 'accept-screen', source: '<script setup lang="ts">const ports=definePorts({emits:{changed:event()}})</script><template><Text /></template>' }))
    const app = addComposition(source)
    Endge.compiler.build({} as never)
    expect(Endge.program.getStoreArtifact('accept-store')?.status).toBe('valid')
    expect(Endge.program.getQueryArtifact('accept-page')?.status).toBe('valid')
    const artifact = Endge.program.getCompositionArtifact(app.identity)!
    expect(artifact.status).toBe('error')
    expect(artifact.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code, severity: 'error', message: expect.any(String), sourcePath: expect.any(String) })]))
  })

  it.each(['props', 'outputs', 'command-input', 'command-output'])('validates custom type references in %s contracts', (location) => {
    const definition = counterDefinition()
    const bad = { key: 'invalid', type: 'MissingAcceptanceType', array: false, optional: false }
    if (location === 'props' || location === 'outputs') {
      definition.contract[location] = [bad]
    }
    else {
      definition.contract.commands.update = { [location === 'command-input' ? 'input' : 'output']: bad }
    }
    removers.push(Endge.runtime.controllers.define(definition))
    const artifact = Endge.compiler.buildController(definition.identity)
    expect(artifact.status).toBe('error')
    expect(artifact.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'type-reference-missing', sourcePath: 'contract.invalid' })]))
  })
})

describe('controller cancellation through actual REST and GraphQL Fetch transport', () => {
  it.each([['rest', 'inputs'], ['rest', 'destroy'], ['graphql', 'inputs'], ['graphql', 'destroy']] as const)('aborts %s during %s and rejects late network data', async (kind, transition) => {
    const { store } = addStoreAndUpdate()
    const query = addQuery(kind)
    const app = addComposition(`defineComposition({data:{orders:store('accept-store')},runtimes:{window:${windowRuntime}},outputs:{rows:output().fromRuntime('window').select('rows')}})`)
    compileAll()
    const transport = delayedFetch()
    const session = await Endge.runtime.composition.mount(app.identity)
    const window = session.host.getChild('window') as ControllerRuntimeHost
    const storeHost = Endge.runtime.getRuntimeHostsByEntity('store', store.identity)[0]
    const on = vi.spyOn(storeHost, 'on')
    const off = vi.spyOn(storeHost, 'off')
    const initialRevision = window.getOutput('rowsRevision')
    const pending = window.command('loadInitial')
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(transport.fetch).toHaveBeenCalledTimes(1))
    const request = transport.requests[0].request
    expect(request.signal.aborted).toBe(false)
    const body = JSON.parse(await request.text())
    expect(kind === 'graphql' ? body.variables : body).toMatchObject({ direction: 'initial', offset: 0, limit: 10 })
    const queryHost = Endge.runtime.getRuntimeHostsByEntity('query', query.identity)[0]
    expect(queryHost.parent?.id).toBe(window.id)
    if (transition === 'inputs') {
      await window.setProps({ request: { status: 'latest' } })
    }
    else {
      await session.unmount()
    }
    await vi.waitFor(() => expect(request.signal.aborted).toBe(true))
    transport.requests[0].complete(reply(kind, 500))
    await rejected
    await vi.waitFor(() => expect(Endge.runtime.getRuntimeHostsByEntity('query', query.identity)).toHaveLength(0))
    if (transition === 'inputs') {
      expect(window.getOutput('rows')).toEqual([])
      expect(window.getOutput('rowsRevision')).toBeGreaterThan(Number(initialRevision))
      expect(window.getOutput('error')).toBeNull()
      expect(session.host.getDataSnapshot()).toMatchObject({ orders: { window: { blocks: [] } } })
      const latest = window.command('loadInitial')
      await vi.waitFor(() => expect(transport.fetch).toHaveBeenCalledTimes(2))
      const nextBody = JSON.parse(await transport.requests[1].request.text())
      expect(kind === 'graphql' ? nextBody.variables : nextBody).toMatchObject({ status: 'latest' })
      transport.requests[1].complete(reply(kind))
      await latest
      expect(window.getOutput('rows')).toEqual(rows().rows)
      await session.unmount()
    }
    expect(Endge.runtime.getRuntimeHostsByEntity('controller', 'endge.collection-window')).toHaveLength(0)
    expect(Endge.runtime.getRuntimeHostsByEntity('store', store.identity)).toHaveLength(0)
    // At least the startup subscription was removed; every subscription installed
    // during input generation changes also has a matching removal.
    const subscribed = on.mock.calls.filter(([event]) => event === 'state:change').length
    const removed = off.mock.calls.filter(([event]) => event === 'state:change').length
    expect(removed).toBe(subscribed + 1)
  })
})
