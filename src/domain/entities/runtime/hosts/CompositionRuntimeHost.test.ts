import type { CompositionProgramPayload } from '@/domain/types/composition-source.types'
import type { ProgramArtifact, QueryProgramPayload } from '@/domain/types/program.types'

import { Raph } from '@endge/raph'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RComposition } from '@/domain/entities/reflect/RComposition'
import { RFilter } from '@/domain/entities/reflect/RFilter'
import { RQuery } from '@/domain/entities/reflect/RQuery'
import { FilterRuntimeHost } from '@/domain/entities/runtime/hosts/FilterRuntimeHost'
import { QueryRuntimeHost } from '@/domain/entities/runtime/hosts/QueryRuntimeHost'
import { compileFilterSource } from '@/domain/services/source-engine/filter-source-compile'
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
    const query = session.host.getChild('query') as QueryRuntimeHost

    expect(session.id).toBe('composition-session')
    expect(session.host.getChildren().map(child => child.name)).toEqual(['filter', 'dateFilter', 'query'])
    expect(session.host.getChild('dateFilter')?.runtimeType).toBe('filter-fields-runtime-host')
    expect(session.host.getFilterFieldsSlice('filter', ['search'])).toMatchObject({
      kind: 'filter-fields',
      runtimeId: 'composition-session:filter:main',
      runtimeName: 'filter',
      fieldKeys: ['search'],
      values: { search: '' },
    })
    expect(run).toHaveBeenCalledTimes(1)
    expect(query.getProps()).toMatchObject({
      filterPayload: { where: { search: '' } },
      filterModel: {
        kind: 'filter-fields',
        runtimeId: 'composition-session:filter:main',
        runtimeName: 'filter',
        fieldKeys: ['search'],
        values: { search: '' },
      },
    })

    await filter.command('set').run({ key: 'search', value: 'S' })
    await filter.command('set').run({ key: 'search', value: 'SU' })
    expect(query.getProps()).toMatchObject({
      filterPayload: { where: { search: 'SU' } },
      filterModel: {
        kind: 'filter-fields',
        runtimeId: 'composition-session:filter:main',
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
    requestBody: null, stableProps: [], outputs: [],
  }
  const compositionPayload: CompositionProgramPayload = {
    type: 'composition', sourceVersion: 1,
    runtimes: [
      { name: 'filter', kind: 'filter', identity: 'schedule-filter', instance: 'main', props: {} },
      { name: 'dateFilter', kind: 'filter-fields', identity: 'filter', instance: 'default', fields: ['search'], props: {} },
      {
        name: 'query', kind: 'query', identity: 'schedule-query', instance: 'default',
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
  }

  Endge.program.beginCompile('test')
  Endge.program.addArtifact(artifact('filter', 1, 'schedule-filter', filterPayload))
  Endge.program.addArtifact(artifact('query', 2, 'schedule-query', queryPayload))
  Endge.program.addArtifact(artifact('composition', 3, 'schedule-page', compositionPayload))
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
    diagnostics: [], dependencies: [], capabilities: ['compilable', 'executable'], payload,
  }
}
