import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Raph } from '@raphy-js/raph'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { EndgeBundleCodec_Service } from '@/features/core/kernel/services/EndgeBundleCodec_Service'
import { ActionProgramExecutor } from '@/features/core/modules/actions/services/ActionProgramExecutor'
import { RAction } from '@/features/core/modules/domain/entities/RAction'
import { RComponentSFC } from '@/features/core/modules/domain/entities/RComponentSFC'
import { RComposition } from '@/features/core/modules/domain/entities/RComposition'
import { RComputation } from '@/features/core/modules/domain/entities/RComputation'
import { RDataView } from '@/features/core/modules/domain/entities/RDataView'
import { RFacetDocument } from '@/features/core/modules/domain/entities/RFacetDocument'
import { RQuery } from '@/features/core/modules/domain/entities/RQuery'
import { RStore } from '@/features/core/modules/domain/entities/RStore'
import { RType } from '@/features/core/modules/domain/entities/RType'
import { EndgeProgram_Module } from '@/features/core/modules/program/EndgeProgram_Module'
import { DATA_VIEW_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/data-view.default.source'
import { QUERY_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/query.default.source'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'
import { prepareTestCompilerContext, resetTestCompilerContext } from '@/test/helpers/compiler-context'

beforeEach(() => {
  prepareTestCompilerContext()
  Endge.workspace.apply({ ...TEST_ENDGE_WORKSPACE, startupCompositionIdentity: 'app' })
  Endge.domain.addFacetDocument(RFacetDocument.fromPlain({ id: 'us', facetIdentity: 'region', identity: 'us', displayName: 'US', configuration: { mode: 'inherit', patch: {} } }))
  Endge.domain.addFacetDocument(RFacetDocument.fromPlain({ id: 'mobile', facetIdentity: 'channel', identity: 'mobile', displayName: 'Mobile', configuration: { mode: 'inherit', patch: {} } }))
})
afterEach(async () => {
  await Endge.runtime.reset()
  resetTestCompilerContext()
  Raph.reset()
})

function composition(identity: string, source: string): void {
  Endge.domain.addComposition(Object.assign(new RComposition(), { id: identity, identity, source }))
}

function query(identity: string, source = QUERY_DEFAULT_SOURCE): void {
  Endge.domain.addQuery(Object.assign(new RQuery(), { id: identity, identity, source }))
}

function compile(region = 'eu', channel = 'web'): void {
  Endge.configuration.build({ dataProvider: 'plain', scope: {}, vars: {}, context: { facets: { region, channel } } })
  Endge.compiler.build({} as never)
  expect(Endge.program.getDiagnostics().filter(item => item.severity === 'error')).toEqual([])
}

function scoped() {
  return Endge.program.exportBundle({ scope: 'startup-composition' })
}

function recordReview(name: string, bundle: ReturnType<typeof scoped>): void {
  if (process.env.ENDGE_BUNDLE_REVIEW_DIR) {
    mkdirSync(process.env.ENDGE_BUNDLE_REVIEW_DIR, { recursive: true })
    writeFileSync(path.join(process.env.ENDGE_BUNDLE_REVIEW_DIR, `${name}.json`), JSON.stringify(bundle, null, 2))
  }
}

describe('context-specific startup export from actual compiler', () => {
  it.each([['eu', 'web', 'eu-web'], ['eu', 'mobile', 'eu-mobile'], ['us', 'web', 'us-web'], ['us', 'mobile', 'us-mobile']])(
    'keeps nested chosen graph for %s/%s and removes other customers from the entire file',
    async (region, channel, selected) => {
      for (const name of ['eu-web', 'eu-mobile', 'us-web', 'us-mobile']) {
        query(`customer-${name}`, QUERY_DEFAULT_SOURCE.replace('endpoint: \'\'', `endpoint: 'https://${name}.example.test'`))
      }
      query('unreachable-private-document')
      composition('app', `defineComposition({ runtimes: { screen: contextSwitch({
        default: composition('europe'), cases: [{ when: { region: 'us' }, use: composition('america') }]
      }) } })`)
      for (const [name, prefix] of [['europe', 'eu'], ['america', 'us']]) {
        composition(name!, `defineComposition({ runtimes: { request: contextSwitch({
          default: query('customer-${prefix}-web'), cases: [{ when: { channel: 'mobile' }, use: query('customer-${prefix}-mobile') }]
        }) } })`)
      }
      compile(region, channel)
      const full = Endge.program.exportBundle({ includeAst: true })
      expect(Object.values(full.artifacts).some(item => item.ref.identity === 'unreachable-private-document')).toBe(true)
      const bundle = scoped()
      expect(Object.values(bundle.artifacts).map(item => item.ref.identity).sort()).toEqual([
        'app',
        region === 'eu' ? 'europe' : 'america',
        `customer-${selected}`,
      ].sort())
      expect(bundle.context.facets).toMatchObject({ region, channel })
      expect(bundle.catalog.folders).toEqual({})
      const text = JSON.stringify(bundle)
      for (const name of ['eu-web', 'eu-mobile', 'us-web', 'us-mobile'].filter(name => name !== selected)) {
        expect(text).not.toContain(`customer-${name}`)
        expect(text).not.toContain(`https://${name}.example.test`)
      }
      expect(text).not.toContain('unreachable-private-document')
      expect(text).not.toContain('contextSwitch')
      if (process.env.ENDGE_BUNDLE_REVIEW_DIR) {
        mkdirSync(process.env.ENDGE_BUNDLE_REVIEW_DIR, { recursive: true })
        writeFileSync(path.join(process.env.ENDGE_BUNDLE_REVIEW_DIR, `${selected}.json`), JSON.stringify(bundle, null, 2))
      }
      expect(bundle.programId).not.toBe(full.programId)
      expect(scoped().programId).toBe(bundle.programId)
      const codec = new EndgeBundleCodec_Service()
      for (const format of ['json', 'gzip'] as const) {
        const decoded = await codec.decode(await codec.encode({ format: 'endge-bundle', version: 1, bundle }, format))
        expect(decoded.bundle).toEqual(bundle)
        const installed = new EndgeProgram_Module()
        installed.installBundle(installed.prepareInstall(decoded.bundle!))
        expect(installed.getCompositionArtifact('app')).toBeTruthy()
        expect(installed.getQueryArtifact(`customer-${selected}`)).toBeTruthy()
        expect(installed.getQueryArtifact('unreachable-private-document')).toBeNull()
        expect(installed.exportBundle()).toEqual(bundle)
      }
      expect(Endge.program.exportBundle({ includeAst: true })).toEqual(full)
    },
  )

  it.each(['eu', 'us'])('projects selected Query contracts and DataViews for %s, without type variants or authoring source', (region) => {
    for (const name of ['EU_PRIVATE', 'US_PRIVATE']) {
      Endge.domain.addType(Object.assign(new RType(), { id: name, identity: name, source: `defineType({ code: field('String') })` }))
      Endge.domain.addDataView(Object.assign(new RDataView(), { id: name, identity: name, source: DATA_VIEW_DEFAULT_SOURCE }))
    }
    query('selected-query', `defineQuery({ kind: 'rest', props: defineProps({
      row: field(contextSwitch({ default: type('EU_PRIVATE'), cases: [{ when: { region: 'us' }, use: type('US_PRIVATE') }] })).optional()
    }), request: { endpoint: '', path: '/items', method: 'GET' }, outputs: {
      rows: output().from(response('items')).dataView(contextSwitch({ default: dataView('EU_PRIVATE'), cases: [{ when: { region: 'us' }, use: dataView('US_PRIVATE') }] }))
    } })`)
    composition('app', `defineComposition({ runtimes: { request: query('selected-query') } })`)
    compile(region)
    const bundle = scoped()
    const selected = region === 'eu' ? 'EU_PRIVATE' : 'US_PRIVATE'
    recordReview(`query-types-${region}`, bundle)
    const rejected = region === 'eu' ? 'US_PRIVATE' : 'EU_PRIVATE'
    const text = JSON.stringify(bundle)
    expect(text).toContain(selected)
    expect(text).not.toContain(rejected)
    expect(text).not.toContain('typeVariants')
    expect(text).not.toContain('contextVariants')
    expect(Object.values(bundle.artifacts).filter(item => item.ref.identity === selected).map(item => item.ref.entityType).sort()).toEqual(['data-view', 'type'])
  })

  it('rejects AST and missing startup, validates rejected branches, and refuses legacy graphs', () => {
    query('request')
    composition('app', `defineComposition({ runtimes: { request: query('request') } })`)
    compile()
    expect(() => Endge.program.exportBundle({ scope: 'startup-composition', includeAst: true })).toThrow('AST')
    expect(() => Endge.program.exportBundle({ scope: 'typo' as never })).toThrow('Unsupported export scope')
    const legacy = Endge.program.exportBundle()
    delete legacy.executionGraphVersion
    const program = new EndgeProgram_Module()
    program.installBundle(program.prepareInstall(legacy))
    expect(() => program.exportBundle({ scope: 'startup-composition' })).toThrow('Recompile')
    Endge.workspace.apply({ ...TEST_ENDGE_WORKSPACE, startupCompositionIdentity: null })
    compile()
    expect(scoped).toThrow('Startup Composition')
  })

  it('does not silently export when an unselected context branch is invalid', () => {
    query('request')
    composition('app', `defineComposition({ runtimes: { request: contextSwitch({ default: query('request'), cases: [{ when: { region: 'us' }, use: query('missing-private') }] }) } })`)
    Endge.compiler.build({} as never)
    expect(Endge.program.status).toBe('error')
    expect(scoped).toThrow()
  })

  it.each(['eu', 'us'])('executes the decoded chosen query, publishes Store data, and preserves lazy runtime nodes for %s', async (region) => {
    for (const name of ['eu', 'us']) {
      query(`request-${name}`, QUERY_DEFAULT_SOURCE.replace('enabled: false', 'enabled: true').replace('data: null', `data: { items: [{ id: '${name}' }] }`))
    }
    query('deferred-request')
    Endge.domain.addStore(Object.assign(new RStore(), { id: 'state', identity: 'state', source: `defineStore({ data: { rows: value([]) } })` }))
    composition('app', `defineComposition({ data: { state: store('state') }, runtimes: {
      request: contextSwitch({ default: query('request-eu'), cases: [{ when: { region: 'us' }, use: query('request-us') }] }).storeTo(data('state'), { rows: output('raw') }),
      deferred: query('deferred-request').activateOn(manual())
    }, hooks: [onMount().run('request')], outputs: { rows: output().fromRuntime('request').select('raw') } })`)
    compile(region)
    const exported = scoped()
    expect(Object.values(exported.artifacts).map(item => item.ref.identity)).toContain('deferred-request')
    Endge.program.installBundle(Endge.program.prepareInstall(exported))
    const session = await Endge.runtime.composition.mount('app')
    expect(session.output('rows')).toEqual([{ id: region }])
    expect(session.host.getChild('deferred')).toBeNull()
    await session.unmount()
  })

  it('preserves transitive Action calls and opaque literals, but removes unrelated host requirements', async () => {
    query('action-request')
    Endge.domain.addAction(Object.assign(new RAction(), { id: 'run-action', identity: 'run-action', source: `defineAction({
      contract: { input: field('Object'), output: field('Object') },
      steps: { request: query({ identity: 'action-request', input: input() }) }, output: output('request')
    })` }))
    Endge.domain.addComponentSFC(Object.assign(new RComponentSFC(), { id: 'screen', identity: 'screen', source: `<template><Text @click="action({ identity: 'run-action', input: { ast: 'business-value', contextSwitch: 'business-value' } })">Run</Text></template>` }))
    composition('app', `defineComposition({ runtimes: { screen: component('screen') } })`)
    compile()
    const bundle = scoped()
    expect(Object.values(bundle.artifacts).map(item => item.ref.identity)).toEqual(expect.arrayContaining(['app', 'screen', 'run-action', 'action-request']))
    const action = Object.values(bundle.artifacts).find(item => item.ref.identity === 'run-action')!
    const calls: unknown[] = []
    const executor = new ActionProgramExecutor({
      resolveQuery: identity => Endge.domain.getQuery(identity),
      runQuery: async (model, input) => {
        calls.push([model.identity, input])
        return { received: input }
      },
      executeAction: async () => undefined,
      runComputation: async () => undefined,
      executeSandbox: async () => undefined,
      resolveOperationHistory: () => null,
      runDataView: () => undefined,
      executeConverter: () => undefined,
    })
    const input = { ast: 'business-value', contextSwitch: 'business-value' }
    const result = await executor.run(action.payload as never, input, null)
    expect(calls).toEqual([['action-request', input]])
    expect(result).toEqual({ received: input })
    expect(JSON.stringify(bundle)).toContain('business-value')
    const screen = Object.values(bundle.artifacts).find(item => item.ref.identity === 'screen')!
    expect(JSON.stringify(screen.payload)).toContain('"ast"')
    expect(JSON.stringify(screen.payload)).toContain('"contextSwitch"')
  })

  it.each(['eu', 'us'])('keeps the selected SFC Query-port provider for %s and removes validation providers and tags', (region) => {
    for (const name of ['eu-port', 'us-port', 'common-default']) {
      query(name)
    }
    Endge.domain.addComponentSFC(Object.assign(new RComponentSFC(), {
      id: 'editor',
      identity: 'editor',
      tag: 'Shared.Editor',
      source: `<script setup lang="ts">const ports = definePorts({ require: { load: query<Object, void>({ default: 'common-default' }) } })</script><template><Text>Editor</Text></template>`,
    }))
    Endge.domain.addComponentSFC(Object.assign(new RComponentSFC(), {
      id: 'screen',
      identity: 'screen',
      tag: 'Selected.Screen',
      source: `<template><Shared.Editor :load="contextSwitch({ default: query('eu-port'), cases: [{ when: { region: 'us' }, use: query('us-port') }] })" /></template>`,
    }))
    Endge.domain.addComponentSFC(Object.assign(new RComponentSFC(), { id: 'private-screen', identity: 'private-screen', tag: 'Private.Screen', source: '<template><Text>Unrelated</Text></template>' }))
    composition('app', `defineComposition({ runtimes: { screen: component('screen') } })`)
    compile(region)
    const bundle = scoped()
    expect(bundle.requirements.componentTags.map(tag => tag.identity).sort()).toEqual(['editor', 'screen'])
    recordReview(`sfc-ports-${region}`, bundle)
    const text = JSON.stringify(bundle)
    expect(text).toContain(`${region}-port`)
    expect(text).not.toContain(region === 'eu' ? 'us-port' : 'eu-port')
    expect(text).not.toContain('private-screen')
    expect(text).not.toContain('contextValidation')
    expect(text).not.toContain('common-default')
  })

  it('keeps only reachable host Action requirements, and refuses a missing required artifact', () => {
    const dispose = ['used.host', 'unused.host'].map(identity => Endge.actions.define({ identity, origin: { kind: 'builtin', owner: 'test-host' }, defaultImplementation: { kind: 'provider', providerKey: identity } }))
    try {
      for (const [identity, action] of [['screen', 'used.host'], ['unrelated', 'unused.host']]) {
        Endge.domain.addComponentSFC(Object.assign(new RComponentSFC(), { id: identity, identity, source: `<template><Text @click="action({ identity: '${action}' })" /></template>` }))
      }
      composition('app', `defineComposition({ runtimes: { screen: component('screen') } })`)
      compile()
      expect(scoped().requirements.hostActions?.map(action => action.identity)).toEqual(['used.host'])
      expect(JSON.stringify(scoped())).not.toContain('unused.host')
      const broken = scoped()
      delete broken.artifacts['component-sfc:screen']
      expect(() => new EndgeProgram_Module().prepareInstall(broken)).toThrow('Missing artifact dependency')
    }
    finally {
      dispose.forEach(release => release())
    }
  })

  it.each(['eu', 'us'])('removes other GraphQL fragment bodies and disabled scopes for %s', (region) => {
    query('graphql', `defineQuery({ kind: 'graphql', request: {
      endpoint: '', document: gql\`query Load { item { ...Selected } }\`,
      fragments: { Selected: contextSwitch({ default: gql\`fragment Selected on Item { EU_SECRET_FIELD }\`, cases: [{ when: { region: 'us' }, use: gql\`fragment Selected on Item { US_SECRET_FIELD }\` }] }) }
    }, outputs: { rows: output().from(data('item')) } })`)
    query('US_ONLY_DISABLED')
    composition('app', `defineComposition({ runtimes: { request: query('graphql'), private: scope({ runtimes: { request: query('US_ONLY_DISABLED') } }).enabledWhen(context({ region: 'us' })) } })`)
    compile(region)
    const graph = scoped()
    recordReview(`graphql-${region}`, graph)
    const text = JSON.stringify(graph)
    expect(text).toContain(region === 'eu' ? 'EU_SECRET_FIELD' : 'US_SECRET_FIELD')
    expect(text).not.toContain(region === 'eu' ? 'US_SECRET_FIELD' : 'EU_SECRET_FIELD')
    if (region === 'eu') {
      expect(text).not.toContain('US_ONLY_DISABLED')
    }
    else {
      expect(text).toContain('US_ONLY_DISABLED')
    }
  })

  it.each(['eu', 'us'])('preserves selected Type inheritance and excludes other base types for %s', (region) => {
    for (const [identity, field] of [['EU_BASE', 'europeField'], ['US_BASE', 'americaField']]) {
      Endge.domain.addType(Object.assign(new RType(), { id: identity, identity, source: `defineType({ ${field}: field(String) })` }))
    }
    Endge.domain.addType(Object.assign(new RType(), { id: 'ChosenType', identity: 'ChosenType', source: `defineType({ extends: contextSwitch({ default: type('EU_BASE'), cases: [{ when: { region: 'us' }, use: type('US_BASE') }] }), fields: { sharedField: field(String) } })` }))
    query('typed-query', `defineQuery({ kind: 'rest', props: defineProps({ row: field('ChosenType').optional() }), request: { endpoint: '', path: '/typed', method: 'GET' }, outputs: { raw: output().from(response()) } })`)
    composition('app', `defineComposition({ runtimes: { request: query('typed-query') } })`)
    compile(region)
    const text = JSON.stringify(scoped())
    expect(text).toContain('sharedField')
    expect(text).toContain(region === 'eu' ? 'europeField' : 'americaField')
    expect(text).not.toContain(region === 'eu' ? 'americaField' : 'europeField')
    expect(text).not.toContain(region === 'eu' ? 'US_BASE' : 'EU_BASE')
  })

  it('preserves an unoverridden required provider when the same component is also mounted directly', () => {
    for (const name of ['default-provider', 'override-provider']) {
      query(name)
    }
    Endge.domain.addComponentSFC(Object.assign(new RComponentSFC(), {
      id: 'editor',
      identity: 'editor',
      tag: 'Shared.Editor',
      source: `<script setup lang="ts">const ports = definePorts({ require: { load: query<Object, void>({ default: 'default-provider' }) } })</script><template><Text>Editor</Text></template>`,
    }))
    Endge.domain.addComponentSFC(Object.assign(new RComponentSFC(), { id: 'screen', identity: 'screen', source: `<template><Shared.Editor :load="query('override-provider')" /></template>` }))
    composition('app', `defineComposition({ runtimes: { screen: component('screen'), direct: component('editor') } })`)
    compile()
    const identities = Object.values(scoped().artifacts).map(artifact => artifact.ref.identity)
    expect(identities).toEqual(expect.arrayContaining(['default-provider', 'override-provider', 'editor', 'screen', 'app']))
  })

  it('specializes computation port calls without retaining an overridden default provider', () => {
    for (const identity of ['FOREIGN_COMPUTATION', 'selected-computation']) {
      Endge.domain.addComputation(Object.assign(new RComputation(), { id: identity, identity, source: 'defineComputation({ outputs: { result: input() }, result: output("result") })' }))
    }
    Endge.domain.addComponentSFC(Object.assign(new RComponentSFC(), {
      id: 'editor',
      identity: 'editor',
      tag: 'Shared.Editor',
      source: `<script setup lang="ts">const ports = definePorts({ require: { state: computation<Object, Object>({ default: 'FOREIGN_COMPUTATION' }) } }); const state = ports.require.state({ value: 'selected' })</script><template><Text :value="state.value" /></template>`,
    }))
    Endge.domain.addComponentSFC(Object.assign(new RComponentSFC(), { id: 'screen', identity: 'screen', source: `<template><Shared.Editor :state="computation('selected-computation')" /></template>` }))
    composition('app', `defineComposition({ runtimes: { screen: component('screen') } })`)
    compile()
    const bundle = scoped()
    recordReview('computation-port', bundle)
    expect(JSON.stringify(bundle)).not.toContain('FOREIGN_COMPUTATION')
    const editor = Object.values(bundle.artifacts).find(artifact => artifact.ref.identity === 'editor')!
    expect((editor.payload as any).ir.script.portCalls[0].defaultIdentity).toBe('selected-computation')
  })

  it.each([['eu', false], ['us', false], ['eu', true], ['us', true]] as const)('keeps only the chosen Store-derived DataView for %s (inline=%s)', async (region, inline) => {
    for (const name of ['EU_DERIVED', 'US_DERIVED']) {
      Endge.domain.addDataView(Object.assign(new RDataView(), { id: name, identity: name, source: 'defineDataView({ mode: "pipeline", steps: [from("").as("row"), map({ ...spread("row") })] })' }))
    }
    const reference = 'contextSwitch({ default: dataView(\'EU_DERIVED\'), cases: [{ when: { region: \'us\' }, use: dataView(\'US_DERIVED\') }] })'
    const selectedView = inline ? `defineDataView({ mode: 'pipeline', steps: [from('').dataView(${reference}).as('row'), map({ ...spread('row') })] })` : reference
    Endge.domain.addStore(Object.assign(new RStore(), { id: 'state', identity: 'state', source: `defineStore({ data: {
      raw: value([{ id: 1 }]), rows: derived().from('raw').dataView(${selectedView})
    } })` }))
    composition('app', `defineComposition({ data: { state: store('state') }, runtimes: {} })`)
    compile(region)
    const bundle = scoped()
    recordReview(`store-derived-${region}-${inline ? 'inline' : 'external'}`, bundle)
    expect(JSON.stringify(bundle)).toContain(region === 'eu' ? 'EU_DERIVED' : 'US_DERIVED')
    expect(JSON.stringify(bundle)).not.toContain(region === 'eu' ? 'US_DERIVED' : 'EU_DERIVED')
    Endge.program.installBundle(Endge.program.prepareInstall(bundle))
    const session = await Endge.runtime.composition.mount('app')
    expect(Raph.get(session.host.getDataPath('state', 'rows'))).toEqual([{ id: 1 }])
    await session.unmount()
  })
})
