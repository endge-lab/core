import type { CompositionProgramPayload, CompositionRuntimeOutputHandle } from '@/domain/types/source/composition-source.types'
import type { ProgramArtifact, QueryProgramPayload } from '@/domain/types/program/program.types'
import type { StoreSourceArtifact } from '@/domain/types/source/store-source.types'

import { Raph } from '@endge/raph'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RComposition } from '@/domain/entities/reflect/RComposition'
import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { RFilter } from '@/domain/entities/reflect/RFilter'
import { RQuery } from '@/domain/entities/reflect/RQuery'
import { RMock } from '@/domain/entities/reflect/RMock'
import { RStore } from '@/domain/entities/reflect/RStore'
import { FilterViewRuntimeHost } from '@/domain/entities/runtime/hosts/FilterViewRuntimeHost'
import { FilterRuntimeHost } from '@/domain/entities/runtime/hosts/FilterRuntimeHost'
import { QueryRuntimeHost } from '@/domain/entities/runtime/hosts/QueryRuntimeHost'
import { CompositionRuntimeHost } from '@/domain/entities/runtime/hosts/CompositionRuntimeHost'
import { StoreRuntimeHost } from '@/domain/entities/runtime/hosts/StoreRuntimeHost'
import { compileFilterSource } from '@/model/services/source-engine/compilers/filter-source-compile'
import { buildRuntimeGraph } from '@/model/services/source-engine/compilers/composition-source-compile'
import { Endge } from '@/model/endge/kernel/endge'
import { materializeCompositionPreviewProps } from '@/model/endge/runtime/execution/endge-composition'

describe('Composition runtime session', () => {
  afterEach(() => {
    Endge.context.setDataMode('live')
    vi.useRealTimers()
    vi.restoreAllMocks()
    Endge.runtime.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Raph.app.reset()
  })

  it('materializes isolated inline and RMock-backed preview props on demand', () => {
    Endge.context.setDataMode('mock')
    const mock = new RMock()
    mock.id = 49
    mock.identity = 'groundhandling-query-requirements'
    mock.name = 'Ground handling requirements'
    mock.displayName = mock.name
    mock.source = JSON.stringify({ arrival: { attributes: ['LegStatus'] } })
    Endge.domain.addMock(mock)

    const first = materializeCompositionPreviewProps({
      airport: { kind: 'literal', value: 'SVO' },
      requirements: { kind: 'mock', identity: mock.identity },
    })
    ;(first.requirements as any).arrival.attributes.push('BestOn')
    const second = materializeCompositionPreviewProps({
      airport: { kind: 'literal', value: 'SVO' },
      requirements: { kind: 'mock', identity: mock.identity },
    })

    expect(first.airport).toBe('SVO')
    expect(second.requirements).toEqual({ arrival: { attributes: ['LegStatus'] } })
  })

  it('omits RMock-backed preview props in live mode but keeps literal fixtures', () => {
    expect(materializeCompositionPreviewProps({
      airport: { kind: 'literal', value: 'SVO' },
      requirements: { kind: 'mock', identity: 'groundhandling-query-requirements' },
    })).toEqual({ airport: 'SVO' })
  })

  it('mounts children, binds output, debounces changes and unmounts the runtime tree', async () => {
    vi.useFakeTimers()
    const run = vi.spyOn(QueryRuntimeHost.prototype, 'run').mockResolvedValue({})
    installDomainAndProgram()

    const session = await Endge.runtime.composition.mount('schedule-page', { id: 'composition-session' })
    const filter = (session.outputs.filter as CompositionRuntimeOutputHandle)?.runtime as FilterRuntimeHost
    const filterView = session.host.getChild('dateFilter') as FilterViewRuntimeHost
    const query = session.host.getChild('query') as QueryRuntimeHost

    expect(session.id).toBe('composition-session')
    expect(session.host.getChildren().map(child => child.name)).toEqual(['filter', 'dateFilter', 'query'])
    expect(filter.node?.parent).toBe(session.host.node)
    expect(filterView.node?.parent).toBe(session.host.node)
    expect(query.node?.parent).toBe(session.host.node)
    expect(session.host.node?.parent?.id).toBe('__endge.runtime.scope.app')
    expect(session.host.getChild('dateFilter')?.runtimeType).toBe('filter-view-runtime-host')
    expect(session.host.getChild('dateFilter')?.hasCapability('renderable')).toBe(true)
    expect(filterView.getProps()).toMatchObject({
      showLabels: true,
      labels: { search: 'Поиск рейса' },
      requestPreview: { where: { search: '' } },
    })
    expect(session.host.getFilterFieldsSlice('filter', ['search'])).toMatchObject({
      kind: 'filter-fields',
      runtimeId: filter.id,
      runtimeName: 'filter',
      fieldKeys: ['search'],
      values: { search: '' },
    })
    expect(run).toHaveBeenCalledTimes(1)
    expect(query.getProps()).toMatchObject({
      filterPayload: { where: { search: '' } },
      filterModel: {
        kind: 'filter-fields',
        runtimeId: filter.id,
        runtimeName: 'filter',
        fieldKeys: ['search'],
        values: { search: '' },
      },
    })
    await filter.action('set').run({ key: 'search', value: 'S' })
    await filter.action('set').run({ key: 'search', value: 'SU' })
    expect(filterView.getProps().requestPreview).toEqual({ where: { search: 'SU' } })
    expect(query.getProps()).toMatchObject({
      filterPayload: { where: { search: 'SU' } },
      filterModel: {
        kind: 'filter-fields',
        runtimeId: filter.id,
        runtimeName: 'filter',
        fieldKeys: ['search'],
        values: { search: 'SU' },
      },
    })
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(20)
    expect(run).toHaveBeenCalledTimes(2)

    await filter.action('set').run({ key: 'search', value: 'S7' })
    await session.unmount()
    await vi.advanceTimersByTimeAsync(20)
    expect(run).toHaveBeenCalledTimes(2)
    expect(Endge.runtime.getRuntimeHosts()).toEqual([])
    await session.unmount()
  })

  it('publishes Query outputs atomically into Store data and recomputes derived fields', async () => {
    const rows = [{ id: 1, flight: 'SU100' }]
    vi.spyOn(QueryRuntimeHost.prototype, 'run').mockImplementation(async function (this: QueryRuntimeHost) {
      Raph.set(this.outputPath('raw'), rows)
      return { raw: rows }
    })

    const store = new RStore()
    store.id = 10
    store.identity = 'schedule'
    store.name = 'Schedule'
    store.source = `defineStore({
      data: {
        raw: value([]),
        table: derived()
          .from('raw')
          .dataView(defineDataView({
            mode: 'pipeline',
            steps: [
              from('').as('row'),
              map({ ...spread('row') }),
            ],
          })),
      },
    })`
    const query = new RQuery()
    query.id = 11
    query.identity = 'schedule-query'
    query.name = 'Schedule query'
    const composition = new RComposition()
    composition.id = 12
    composition.identity = 'schedule-store-page'
    composition.name = 'Schedule Store page'
    Endge.domain.addStore(store)
    Endge.domain.addQuery(query)
    Endge.domain.addComposition(composition)

    const queryPayload: QueryProgramPayload = {
      type: 'query-rest', sourceVersion: 2, endpoint: '', query: '',
      props: [], requestBody: null,
      outputs: [{ key: 'raw', source: { type: 'response', path: null }, dataViews: [], materialization: { kind: 'source' } }],
    }
    const compositionPayload = makeCompositionPayload({
      data: [{ name: 'schedule', kind: 'store', identity: 'schedule' }],
      runtimes: [{
        name: 'query', kind: 'query', identity: 'schedule-query', props: {},
        storeTo: [{ data: 'schedule', fields: { raw: 'raw' } }],
      }],
      hooks: [{ kind: 'mount', target: 'query' }],
      outputs: [],
    })
    Endge.program.beginCompile('test')
    Endge.program.addArtifact(artifact('query', 11, 'schedule-query', queryPayload))
    Endge.program.addArtifact(artifact(
      'store',
      10,
      'schedule',
      Endge.source.compile('store', store.source).artifact as StoreSourceArtifact,
    ))
    Endge.program.addArtifact(artifact('composition', 12, 'schedule-store-page', compositionPayload))

    const session = await Endge.runtime.composition.mount('schedule-store-page', { id: 'composition-store' })
    const storeRuntime = Endge.runtime
      .getRuntimeHostsByEntity('store', 'schedule', 'app')
      .find(runtime => runtime.parent?.id === session.id) as StoreRuntimeHost
    const base = storeRuntime.getDataPath()
    expect(session.host.basePath).toBe('runtime.compositions.composition-store')
    expect(base).toBe('runtime.stores.schedule-0')
    expect(Raph.get(`${base}.raw`)).toEqual(rows)
    expect(Raph.get(`${base}.table`)).toEqual(rows)
    expect(session.host.getDataSnapshot()).toEqual({
      schedule: { raw: rows, table: rows },
    })

    await session.unmount()
    expect(Raph.get(base)).toBeUndefined()
  })

  it('borrows an explicit Store runtime without destroying it on Composition unmount', async () => {
    const store = new RStore()
    store.id = 30
    store.identity = 'shared-db'
    store.name = 'Shared DB'
    store.source = 'defineStore({ data: { raw: value([1]) } })'
    const composition = new RComposition()
    composition.id = 31
    composition.identity = 'shared-page'
    composition.name = 'Shared page'
    Endge.domain.addStore(store)
    Endge.domain.addComposition(composition)

    const storePayload = Endge.source.compile('store', store.source).artifact as StoreSourceArtifact
    const compositionPayload = makeCompositionPayload({
      data: [{ name: 'db', kind: 'store', identity: 'shared-db' }],
      runtimes: [],
      hooks: [],
      outputs: [],
    })
    Endge.program.beginCompile('test')
    Endge.program.addArtifact(artifact('store', 30, 'shared-db', storePayload))
    Endge.program.addArtifact(artifact('composition', 31, 'shared-page', compositionPayload))

    const sharedRuntime = Endge.runtime.execute(store, { id: 'store:shared-db-preview' }) as StoreRuntimeHost
    const session = await Endge.runtime.composition.mount('shared-page', {
      id: 'composition:shared-page-preview',
      dataRuntimes: { db: sharedRuntime.id },
    })
    expect(session.host.getDataPath('db')).toBe(sharedRuntime.getDataPath())
    expect(session.host.getDataSnapshot()).toEqual({ db: { raw: [1] } })

    await session.unmount()
    expect(Endge.runtime.getRuntimeById(sharedRuntime.id)).toBe(sharedRuntime)
    expect(sharedRuntime.getDataSnapshot()).toEqual({ raw: [1] })
  })

  it('reuses the nearest ancestor Store and creates a local fallback in standalone preview', async () => {
    installContextualStoreCompositions({ resolution: 'contextual', parentHasStore: true })

    const session = await Endge.runtime.composition.mount('context-parent')
    const child = session.host.getChild('child') as CompositionRuntimeHost
    const parentPath = session.host.getDataPath('shared')
    const childPath = child.getDataPath('local')
    const stores = Endge.runtime.getRuntimeHostsByEntity('store', 'context-store') as StoreRuntimeHost[]

    expect(stores).toHaveLength(1)
    expect(childPath).toBe(parentPath)
    stores[0]?.set('raw', [2])
    expect(session.host.getDataSnapshot()).toEqual({ shared: { raw: [2] } })
    expect(child.getDataSnapshot()).toEqual({ local: { raw: [2] } })

    await session.unmount()
    const preview = await Endge.runtime.composition.mount('context-child')
    const previewStore = Endge.runtime.getRuntimeHostsByEntity('store', 'context-store')[0] as StoreRuntimeHost
    expect(previewStore.parent).toBe(preview.host)
    expect(preview.host.getDataSnapshot()).toEqual({ local: { raw: [1] } })
    await preview.unmount()
  })

  it('supports isolated Store instances and lets explicit withData override isolation', async () => {
    installContextualStoreCompositions({ resolution: 'isolated', parentHasStore: true })
    const isolatedSession = await Endge.runtime.composition.mount('context-parent')
    const isolatedChild = isolatedSession.host.getChild('child') as CompositionRuntimeHost
    expect(Endge.runtime.getRuntimeHostsByEntity('store', 'context-store')).toHaveLength(2)
    expect(isolatedChild.getDataPath('local')).not.toBe(isolatedSession.host.getDataPath('shared'))
    await isolatedSession.unmount()

    await Endge.runtime.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Raph.app.reset()
    installContextualStoreCompositions({ resolution: 'isolated', parentHasStore: true, explicitBinding: true })
    const explicitSession = await Endge.runtime.composition.mount('context-parent')
    const explicitChild = explicitSession.host.getChild('child') as CompositionRuntimeHost
    expect(Endge.runtime.getRuntimeHostsByEntity('store', 'context-store')).toHaveLength(1)
    expect(explicitChild.getDataPath('local')).toBe(explicitSession.host.getDataPath('shared'))
    await explicitSession.unmount()
  })

  it('keeps sibling fallbacks separate and rejects a missing injected Store provider', async () => {
    installContextualStoreCompositions({ resolution: 'contextual', parentHasStore: false, childNames: ['left', 'right'] })
    const session = await Endge.runtime.composition.mount('context-parent')
    const left = session.host.getChild('left') as CompositionRuntimeHost
    const right = session.host.getChild('right') as CompositionRuntimeHost
    expect(Endge.runtime.getRuntimeHostsByEntity('store', 'context-store')).toHaveLength(2)
    expect(left.getDataPath('local')).not.toBe(right.getDataPath('local'))
    await session.unmount()

    await Endge.runtime.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Raph.app.reset()
    installContextualStoreCompositions({ resolution: 'injected', parentHasStore: false })
    await expect(Endge.runtime.composition.mount('context-child')).rejects.toThrow('requires provider "context-store"')
    expect(Endge.runtime.getRuntimeHosts()).toEqual([])
  })

  it('passes public props into nested and standalone Compositions before their onMount queries run', async () => {
    const run = vi.spyOn(QueryRuntimeHost.prototype, 'run').mockResolvedValue({})
    const query = new RQuery()
    query.id = 50
    query.identity = 'attributes-leg-select'
    query.name = 'Attributes'
    const inner = new RComposition()
    inner.id = 51
    inner.identity = 'groundhandling-default'
    inner.name = 'Ground handling requests'
    const outer = new RComposition()
    outer.id = 52
    outer.identity = 'groundhandling-page'
    outer.name = 'Ground handling page'
    const table = new RComponentSFC()
    table.id = 53
    table.identity = 'groundhandling-control-table'
    table.name = 'Ground handling table'
    Endge.domain.addQuery(query)
    Endge.domain.addComposition(inner)
    Endge.domain.addComposition(outer)
    Endge.domain.addComponentSFC(table)

    const queryPayload: QueryProgramPayload = {
      type: 'query-rest', sourceVersion: 2, endpoint: '', query: '',
      props: [{ key: 'names', type: 'String', optional: false, array: true }],
      requestBody: null, outputs: [],
    }
    const requirements = {
      arrival: { attributes: ['LegStatus', 'BestOn'] },
    }
    const innerPayload = makeCompositionPayload({
      props: [{ key: 'requirements', type: 'Object', optional: false, array: false }],
      data: [],
      runtimes: [{
        name: 'attributes', kind: 'query', identity: 'attributes-leg-select', storeTo: [],
        props: {
          names: {
            kind: 'expression',
            expression: { type: 'read', source: 'prop', path: 'requirements.arrival.attributes' },
          },
        },
      }],
      hooks: [{ kind: 'mount', target: 'attributes' }],
      outputs: [],
    })
    const outerPayload = makeCompositionPayload({
      data: [],
      runtimes: [{
        name: 'requests', kind: 'composition', identity: 'groundhandling-default', storeTo: [],
        props: { requirements: { kind: 'runtime-metadata', runtime: 'table', namespace: 'groundhandling.query' } },
      }, {
        name: 'table', kind: 'component', identity: 'groundhandling-control-table', storeTo: [], props: {},
        activationOverride: { mode: 'manual' }, effectiveActivation: { mode: 'manual' },
      }],
      hooks: [],
      outputs: [],
    })
    Endge.program.beginCompile('test')
    Endge.program.addArtifact(artifact('query', 50, 'attributes-leg-select', queryPayload))
    Endge.program.addArtifact(artifact('composition', 51, 'groundhandling-default', innerPayload))
    Endge.program.addArtifact(artifact('composition', 52, 'groundhandling-page', outerPayload))
    Endge.program.addArtifact(artifact('component-sfc', 53, 'groundhandling-control-table', {}, {
      'groundhandling.query': requirements,
    }))

    const session = await Endge.runtime.composition.mount('groundhandling-page')
    const nested = session.host.getChild('requests') as CompositionRuntimeHost
    const attributes = nested.getChild('attributes') as QueryRuntimeHost

    expect(nested.getProps()).toEqual({ requirements })
    expect(attributes.getProps().names).toEqual(['LegStatus', 'BestOn'])
    expect(run).toHaveBeenCalledTimes(1)

    await session.unmount()

    const directRequirements = {
      arrival: { attributes: ['FlightNumber', 'STD'] },
    }
    const direct = await Endge.runtime.composition.mount('groundhandling-default', {
      props: { requirements: directRequirements },
    })
    const directAttributes = direct.host.getChild('attributes') as QueryRuntimeHost

    expect(direct.host.getProps()).toEqual({ requirements: directRequirements })
    expect(directAttributes.getProps().names).toEqual(['FlightNumber', 'STD'])
    expect(run).toHaveBeenCalledTimes(2)

    await direct.unmount()
  })

  it('mounts a nested Composition and exposes its outputs reactively', async () => {
    const initialRows = [{ id: 1, flight: 'SU100' }]
    vi.spyOn(QueryRuntimeHost.prototype, 'run').mockImplementation(async function (this: QueryRuntimeHost) {
      if (this.entityIdentity === 'groundhandling-query')
        Raph.set(this.outputPath('raw'), initialRows)
      return this.getOutputs() as Record<string, unknown>
    })

    const sourceQuery = new RQuery()
    sourceQuery.id = 20
    sourceQuery.identity = 'groundhandling-query'
    sourceQuery.name = 'Ground handling query'
    const consumerQuery = new RQuery()
    consumerQuery.id = 21
    consumerQuery.identity = 'table-consumer'
    consumerQuery.name = 'Table consumer'
    const inner = new RComposition()
    inner.id = 22
    inner.identity = 'groundhandling-default'
    inner.name = 'Ground handling requests'
    const outer = new RComposition()
    outer.id = 23
    outer.identity = 'groundhandling-page'
    outer.name = 'Ground handling page'
    const store = new RStore()
    store.id = 24
    store.identity = 'groundhandling-db'
    store.name = 'Ground handling DB'
    store.source = `defineStore({
      data: {
        raw: value({ rows: [] }),
      },
    })`
    Endge.domain.addQuery(sourceQuery)
    Endge.domain.addQuery(consumerQuery)
    Endge.domain.addComposition(inner)
    Endge.domain.addComposition(outer)
    Endge.domain.addStore(store)

    const sourcePayload: QueryProgramPayload = {
      type: 'query-rest', sourceVersion: 2, endpoint: '', query: '',
      props: [], requestBody: null,
      outputs: [{ key: 'raw', source: { type: 'response', path: null }, dataViews: [], materialization: { kind: 'source' } }],
    }
    const consumerPayload: QueryProgramPayload = {
      type: 'query-rest', sourceVersion: 2, endpoint: '', query: '',
      props: [{ key: 'rows', type: 'Object', optional: true, array: true }],
      requestBody: null, outputs: [],
    }
    const innerPayload = makeCompositionPayload({
      data: [],
      runtimes: [{ name: 'query', kind: 'query', identity: 'groundhandling-query', props: {}, storeTo: [] }],
      hooks: [{ kind: 'mount', target: 'query' }],
      outputs: [{ key: 'rows', runtime: 'query', output: 'raw' }],
    })
    const outerPayload = makeCompositionPayload({
      data: [{ name: 'db', kind: 'store', identity: 'groundhandling-db' }],
      runtimes: [
        {
          name: 'requests', kind: 'composition', identity: 'groundhandling-default', props: {},
          storeTo: [{ data: 'db', fields: { 'raw.rows': 'rows' } }],
        },
        {
          name: 'consumer', kind: 'query', identity: 'table-consumer', storeTo: [],
          props: { rows: { kind: 'output', runtime: 'requests', output: 'rows' } },
        },
      ],
      hooks: [],
      outputs: [{ key: 'rows', runtime: 'requests', output: 'rows' }],
    })
    Endge.program.beginCompile('test')
    Endge.program.addArtifact(artifact('query', 20, 'groundhandling-query', sourcePayload))
    Endge.program.addArtifact(artifact('query', 21, 'table-consumer', consumerPayload))
    Endge.program.addArtifact(artifact(
      'store',
      24,
      'groundhandling-db',
      Endge.source.compile('store', store.source).artifact as StoreSourceArtifact,
    ))
    Endge.program.addArtifact(artifact('composition', 22, 'groundhandling-default', innerPayload))
    Endge.program.addArtifact(artifact('composition', 23, 'groundhandling-page', outerPayload))

    const session = await Endge.runtime.composition.mount('groundhandling-page', { id: 'groundhandling-page-session' })
    const nested = session.host.getChild('requests') as CompositionRuntimeHost
    const consumer = session.host.getChild('consumer') as QueryRuntimeHost
    expect(nested).toBeInstanceOf(CompositionRuntimeHost)
    expect(nested.parent).toBe(session.host)
    expect(consumer.getProps().rows).toEqual(initialRows)
    expect(session.host.getOutput('rows')).toEqual(initialRows)
    expect(session.host.getDataSnapshot()).toEqual({ db: { raw: { rows: initialRows } } })

    const updatedRows = [{ id: 2, flight: 'SU200' }]
    const nestedQuery = nested.getChild('query') as QueryRuntimeHost
    Raph.set(nestedQuery.outputPath('raw'), updatedRows)
    expect(consumer.getProps().rows).toEqual(updatedRows)
    expect(session.host.getOutput('rows')).toEqual(updatedRows)
    expect(session.host.getDataSnapshot()).toEqual({ db: { raw: { rows: updatedRows } } })

    await session.unmount()
    expect(Endge.runtime.getRuntimeHosts()).toEqual([])
  })
})

function installDomainAndProgram(): void {
  const filter = new RFilter()
  filter.id = 1
  filter.identity = 'schedule-filter'
  filter.name = 'Schedule filter'
  filter.displayName = 'Schedule filter'
  const query = new RQuery()
  query.id = 2
  query.identity = 'schedule-query'
  query.name = 'Schedule query'
  const composition = new RComposition()
  composition.id = 3
  composition.identity = 'schedule-page'
  composition.name = 'Schedule page'
  composition.displayName = 'Schedule page'
  Endge.domain.addFilter(filter)
  Endge.domain.addQuery(query)
  Endge.domain.addComposition(composition)

  const filterPayload = compileFilterSource(`
defineFilter({
  fields: { search: field('String').optional().default('') },
  outputs: {
    request: output().json(({ value }) => compact({ where: { search: value('search') } })),
  },
})
`).artifact!
  const queryPayload: QueryProgramPayload = {
    type: 'query-rest', sourceVersion: 2, endpoint: '', query: '',
    props: [
      { key: 'filterPayload', type: 'Object', optional: true, array: false },
      { key: 'filterModel', type: 'Object', optional: true, array: false },
    ],
    requestBody: null, outputs: [],
  }
  const compositionPayload = makeCompositionPayload({
    data: [],
    runtimes: [
      { name: 'filter', kind: 'filter', identity: 'schedule-filter', props: {}, storeTo: [] },
      {
        name: 'dateFilter', kind: 'filter-view', identity: 'filter', fields: ['search'], storeTo: [],
        props: {
          showLabels: { kind: 'literal', value: true },
          labels: { kind: 'literal', value: { search: 'Поиск рейса' } },
          requestPreview: { kind: 'output', runtime: 'filter', output: 'request' },
        },
      },
      {
        name: 'query', kind: 'query', identity: 'schedule-query', storeTo: [],
        props: {
          filterPayload: { kind: 'output', runtime: 'filter', output: 'request' },
          filterModel: { kind: 'filter-fields', runtime: 'filter', fields: ['search'] },
        },
      },
    ],
    hooks: [
      { kind: 'mount', target: 'query' },
      { kind: 'change', runtime: 'filter', output: 'request', target: 'query', debounceMs: 20 },
    ],
    outputs: [{ key: 'filter', runtime: 'filter' }],
  })

  Endge.program.beginCompile('test')
  Endge.program.addArtifact(artifact('filter', 1, 'schedule-filter', filterPayload))
  Endge.program.addArtifact(artifact('query', 2, 'schedule-query', queryPayload))
  Endge.program.addArtifact(artifact('composition', 3, 'schedule-page', compositionPayload))
}

function makeCompositionPayload(document: any): CompositionProgramPayload {
  const runtimes = document.runtimes.map((runtime: any) => ({
    path: runtime.name,
    scopePath: 'scope_default',
    activationOverride: null,
    effectiveActivation: { mode: 'startup' as const },
    ...runtime,
  }))
  const normalized = {
    activation: { mode: 'startup' as const },
    props: document.props ?? [],
    data: document.data,
    resources: [],
    scopes: [{
      name: 'scope_default',
      path: 'scope_default',
      parentPath: null,
      activationOverride: { mode: 'startup' as const },
      effectiveActivation: { mode: 'startup' as const },
      resources: [],
      runtimes: runtimes.map((runtime: any) => runtime.path),
      children: [],
      sourceOrder: 0,
    }],
    runtimes,
    hooks: document.hooks,
    outputs: document.outputs.map((output: any) => ({ kind: 'runtime' as const, ...output })),
  }
  return {
    type: 'composition',
    sourceVersion: 1,
    ...normalized,
    graph: buildRuntimeGraph(normalized),
  }
}

function installContextualStoreCompositions(input: {
  resolution: 'contextual' | 'isolated' | 'injected'
  parentHasStore: boolean
  explicitBinding?: boolean
  childNames?: string[]
}): void {
  const store = new RStore()
  store.id = 40
  store.identity = 'context-store'
  store.name = 'Context Store'
  store.source = 'defineStore({ data: { raw: value([1]) } })'

  const child = new RComposition()
  child.id = 41
  child.identity = 'context-child'
  child.name = 'Context Child'

  const parent = new RComposition()
  parent.id = 42
  parent.identity = 'context-parent'
  parent.name = 'Context Parent'

  Endge.domain.addStore(store)
  Endge.domain.addComposition(child)
  Endge.domain.addComposition(parent)

  const childPayload = makeCompositionPayload({
    data: [{ name: 'local', kind: 'store', identity: 'context-store', resolution: input.resolution }],
    runtimes: [],
    hooks: [],
    outputs: [],
  })
  const childNames = input.childNames ?? ['child']
  const parentPayload = makeCompositionPayload({
    data: input.parentHasStore
      ? [{ name: 'shared', kind: 'store', identity: 'context-store', resolution: 'contextual' }]
      : [],
    runtimes: childNames.map(name => ({
      name,
      kind: 'composition',
      identity: 'context-child',
      props: {},
      dataBindings: input.explicitBinding ? { local: 'shared' } : {},
      storeTo: [],
    })),
    hooks: [],
    outputs: [],
  })

  Endge.program.beginCompile('test')
  Endge.program.addArtifact(artifact(
    'store',
    40,
    'context-store',
    Endge.source.compile('store', store.source).artifact as StoreSourceArtifact,
  ))
  Endge.program.addArtifact(artifact('composition', 41, 'context-child', childPayload))
  Endge.program.addArtifact(artifact('composition', 42, 'context-parent', parentPayload))
}

function artifact<T>(
  entityType: 'filter' | 'query' | 'composition' | 'store' | 'component-sfc',
  id: number,
  identity: string,
  payload: T,
  metadata: Record<string, any> = {},
): ProgramArtifact<T> {
  return {
    ref: { entityType, id, identity },
    sourceHash: 'test', compilerVersion: 'test', status: 'valid',
    diagnostics: [], dependencies: [], capabilities: ['compilable', 'executable'],
    metadata: { self: metadata, nodes: [] }, payload,
  }
}
