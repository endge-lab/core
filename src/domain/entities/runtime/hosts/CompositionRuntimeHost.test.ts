import type { CompositionProgramPayload, CompositionSourceDocument } from '@/domain/types/composition-source.types'
import type { ProgramArtifact, QueryProgramPayload } from '@/domain/types/program.types'

import { Raph } from '@endge/raph'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RComposition } from '@/domain/entities/reflect/RComposition'
import { RFilter } from '@/domain/entities/reflect/RFilter'
import { RQuery } from '@/domain/entities/reflect/RQuery'
import { RStore } from '@/domain/entities/reflect/RStore'
import { FilterViewRuntimeHost } from '@/domain/entities/runtime/hosts/FilterViewRuntimeHost'
import { FilterRuntimeHost } from '@/domain/entities/runtime/hosts/FilterRuntimeHost'
import { QueryRuntimeHost } from '@/domain/entities/runtime/hosts/QueryRuntimeHost'
import { CompositionRuntimeHost } from '@/domain/entities/runtime/hosts/CompositionRuntimeHost'
import { compileFilterSource } from '@/domain/services/source-engine/filter-source-compile'
import { buildRuntimeGraph } from '@/domain/services/source-engine/composition-source-compile'
import { Endge } from '@/model/endge/endge'

describe('Composition runtime session', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    Endge.runtime.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Raph.app.reset()
  })

  it('mounts children, binds output, debounces changes and unmounts the runtime tree', async () => {
    vi.useFakeTimers()
    const run = vi.spyOn(QueryRuntimeHost.prototype, 'run').mockResolvedValue({})
    installDomainAndProgram()

    const session = await Endge.composition.mount('schedule-page', { id: 'composition-session' })
    const filter = session.outputs.filter?.runtime as FilterRuntimeHost
    const filterView = session.host.getChild('dateFilter') as FilterViewRuntimeHost
    const query = session.host.getChild('query') as QueryRuntimeHost

    expect(session.id).toBe('composition-session')
    expect(session.host.getChildren().map(child => child.name)).toEqual(['filter', 'dateFilter', 'query'])
    expect(filter.node?.parent).toBe(session.host.node)
    expect(filterView.node?.parent).toBe(session.host.node)
    expect(query.node?.parent).toBe(session.host.node)
    expect(session.host.node?.parent?.id).toBe('__endge.runtime.app')
    expect(session.host.getChild('dateFilter')?.runtimeType).toBe('filter-view-runtime-host')
    expect(session.host.getChild('dateFilter')?.hasCapability('renderable')).toBe(true)
    expect(filterView.getProps()).toMatchObject({
      showLabels: true,
      labels: { search: 'Поиск рейса' },
      requestPreview: { where: { search: '' } },
    })
    expect(session.host.getFilterFieldsSlice('filter', ['search'])).toMatchObject({
      kind: 'filter-fields',
      runtimeId: 'composition-session:filter',
      runtimeName: 'filter',
      fieldKeys: ['search'],
      values: { search: '' },
    })
    expect(run).toHaveBeenCalledTimes(1)
    expect(query.getProps()).toMatchObject({
      filterPayload: { where: { search: '' } },
      filterModel: {
        kind: 'filter-fields',
        runtimeId: 'composition-session:filter',
        runtimeName: 'filter',
        fieldKeys: ['search'],
        values: { search: '' },
      },
    })
    await filter.command('set').run({ key: 'search', value: 'S' })
    await filter.command('set').run({ key: 'search', value: 'SU' })
    expect(filterView.getProps().requestPreview).toEqual({ where: { search: 'SU' } })
    expect(query.getProps()).toMatchObject({
      filterPayload: { where: { search: 'SU' } },
      filterModel: {
        kind: 'filter-fields',
        runtimeId: 'composition-session:filter',
        runtimeName: 'filter',
        fieldKeys: ['search'],
        values: { search: 'SU' },
      },
    })
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(20)
    expect(run).toHaveBeenCalledTimes(2)

    await filter.command('set').run({ key: 'search', value: 'S7' })
    session.unmount()
    await vi.advanceTimersByTimeAsync(20)
    expect(run).toHaveBeenCalledTimes(2)
    expect(Endge.runtime.getRuntimeHosts()).toEqual([])
    session.unmount()
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
    Endge.program.addArtifact(artifact('composition', 12, 'schedule-store-page', compositionPayload))

    const session = await Endge.composition.mount('schedule-store-page', { id: 'composition-store' })
    const base = '__endge.compositionRuntime.composition-store.data.schedule'
    expect(Raph.get(`${base}.raw`)).toEqual(rows)
    expect(Raph.get(`${base}.table`)).toEqual(rows)
    expect(session.host.getDataSnapshot()).toEqual({
      schedule: { raw: rows, table: rows },
    })

    session.unmount()
    expect(Raph.get(base)).toBeUndefined()
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
    Endge.program.addArtifact(artifact('composition', 22, 'groundhandling-default', innerPayload))
    Endge.program.addArtifact(artifact('composition', 23, 'groundhandling-page', outerPayload))

    const session = await Endge.composition.mount('groundhandling-page', { id: 'groundhandling-page-session' })
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

    session.unmount()
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

function makeCompositionPayload(document: CompositionSourceDocument): CompositionProgramPayload {
  return {
    type: 'composition',
    sourceVersion: 1,
    ...document,
    graph: buildRuntimeGraph(document),
  }
}

function artifact<T>(
  entityType: 'filter' | 'query' | 'composition',
  id: number,
  identity: string,
  payload: T,
): ProgramArtifact<T> {
  return {
    ref: { entityType, id, identity },
    sourceHash: 'test', compilerVersion: 'test', status: 'valid',
    diagnostics: [], dependencies: [], capabilities: ['compilable', 'executable'],
    metadata: { self: {}, nodes: [] }, payload,
  }
}
