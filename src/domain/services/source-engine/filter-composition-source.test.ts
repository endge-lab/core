import { describe, expect, it } from 'vitest'

import { compileCompositionSource } from '@/domain/services/source-engine/composition-source-compile'
import { compileFilterSource } from '@/domain/services/source-engine/filter-source-compile'
import { compileQuerySource } from '@/domain/services/source-engine/query-source-compile'

describe('Filter, Query v2 and Composition source compiler', () => {
  it('compiles Filter fields, options, vocab, defaults and outputs into static IR', () => {
    const result = compileFilterSource(`
defineFilter({
  fields: {
    from: field('Date').default(relativeDate('-1d')),
    direction: field('String').options([{ value: 'departure', label: 'Вылет' }]).default('departure'),
    airlines: field('String').array().vocab('airlines', { valuePath: 'code', labelPath: 'name' }).default([]),
  },
	  outputs: {
	    request: output().json(({ value }) => compact({
	      direction: value('direction'),
	      airlineCode: inList(value('airlines')),
	    })),
	    predicate: output().predicate(({ row, value }) => and(
	      between(row('std'), value('from'), value('from')),
	      inArray(row('airlineCode'), value('airlines')),
    )),
  },
})
`)

    expect(result.diagnostics).toEqual([])
    expect(result.artifact).toMatchObject({
      type: 'filter',
      fields: [
        { key: 'from', type: 'Date', defaultValue: { type: 'operation', operation: 'relative-date' } },
        { key: 'direction', options: [{ value: 'departure', label: 'Вылет' }] },
        { key: 'airlines', array: true, vocab: { identity: 'airlines' } },
      ],
	      outputs: [
	        { key: 'request', kind: 'json' },
	        { key: 'predicate', kind: 'predicate' },
	      ],
	    })
  })

  it('compiles DateTime relative defaults into static IR', () => {
    const result = compileFilterSource(`
defineFilter({
  fields: {
    from: field('DateTime').default(relativeDateTime('-7d', 'startOfDay')),
    to: field('DateTime').default(relativeDateTime('+0d', 'endOfDay')),
  },
  outputs: {
    request: output().json(({ value }) => ({ from: value('from'), to: value('to') })),
  },
})
`)

    expect(result.diagnostics).toEqual([])
    expect(result.artifact).toMatchObject({
      fields: [
        { key: 'from', type: 'DateTime', defaultValue: { type: 'operation', operation: 'relative-date-time' } },
        { key: 'to', type: 'DateTime', defaultValue: { type: 'operation', operation: 'relative-date-time' } },
      ],
    })
  })

  it('rejects legacy fallback, arbitrary JavaScript and incompatible field config', () => {
    expect(compileFilterSource('').diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'filter-source-empty' }),
    ]))

    const result = compileFilterSource(`
defineFilter({
  fields: {
    code: field('String')
      .options([{ value: 'A' }])
      .vocab('codes', { valuePath: 'code', labelPath: 'name' }),
  },
  outputs: {
    request: output().json(() => window.alert('unsafe')),
  },
})
`)
    expect(result.artifact).toBeNull()
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'source-field-options-vocab-conflict' }),
      expect.objectContaining({ code: 'source-expression-unsupported' }),
    ]))
  })

  it('compiles Query props/body and marks dynamic store props stable', () => {
    const result = compileQuerySource(`
defineQuery({
  kind: 'rest',
  props: defineProps({
    filterPayload: field('Object').optional(),
    rowsStoreKey: field('String').default('queries.rows'),
  }),
  request: {
    method: 'POST',
    endpoint: env('API'),
    path: '/search',
    body: body(({ prop }) => merge({ limit: 500 }, prop('filterPayload'))),
  },
  outputs: {
    rows: output().from(response('items')).toStore(prop('rowsStoreKey')),
  },
})
`)
    expect(result.diagnostics).toEqual([])
    expect(result.artifact).toMatchObject({
      props: [{ key: 'filterPayload' }, { key: 'rowsStoreKey' }],
      requestBody: { type: 'operation', operation: 'merge' },
      stableProps: ['rowsStoreKey'],
    })
  })

  it('compiles Composition graph and rejects cycles, duplicate persist keys and render config', () => {
    const valid = compileCompositionSource(`
	defineComposition({
	  runtimes: {
	    filter: filter('schedule').instance('main').persist({ key: 'schedule' }),
	    dateFilter: filterFields('filter').fields(['from']),
	    query: query('search').withProps({
	      payload: fromOutput('filter', 'request'),
	      filterModel: fromFilter('filter').fields(['from', 'direction']),
	    }),
	  },
  hooks: [
    onMount().run('query'),
    onChange('filter.request').debounce(200).run('query'),
  ],
	  outputs: {
	    filter: output().fromRuntime('filter'),
	  },
	})
	`)
	    expect(valid.diagnostics).toEqual([])
	    expect(valid.artifact?.hooks).toHaveLength(2)
	    expect(valid.artifact?.runtimes.find(runtime => runtime.name === 'dateFilter')).toMatchObject({
	      kind: 'filter-fields',
	      identity: 'filter',
	      fields: ['from'],
	    })
	    expect(valid.artifact?.runtimes.find(runtime => runtime.name === 'query')?.props.filterModel).toEqual({
	      kind: 'filter-fields',
	      runtime: 'filter',
	      fields: ['from', 'direction'],
	    })

    const invalid = compileCompositionSource(`
defineComposition({
  runtimes: {
    a: query('a').withProps({ value: fromOutput('b', 'raw') }),
    b: query('b').withProps({ value: fromOutput('a', 'raw') }),
    one: filter('one').persist({ key: 'same' }),
    two: filter('two').persist({ key: 'same' }),
  },
  outputs: {},
  render: {},
})
`)
    expect(invalid.artifact).toBeNull()
    expect(invalid.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'composition-binding-cycle' }),
      expect.objectContaining({ code: 'composition-persist-key-duplicate' }),
      expect.objectContaining({ code: 'composition-source-property-unsupported' }),
    ]))
  })
})
