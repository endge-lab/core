import { describe, expect, it } from 'vitest'

import { compileCompositionSource } from '@/model/services/source-engine/compilers/composition-source-compile'
import { compileFilterSource } from '@/model/services/source-engine/compilers/filter-source-compile'
import { compileQuerySource } from '@/model/services/source-engine/compilers/query-source-compile'

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

  it('compiles Time fields with string defaults and rejects non-string defaults', () => {
    const valid = compileFilterSource(`
defineFilter({
  fields: {
    from: field('Time').default('06:30'),
  },
  outputs: {
    request: output().json(({ value }) => ({ from: value('from') })),
  },
})
`)

    expect(valid.diagnostics).toEqual([])
    expect(valid.artifact).toMatchObject({
      fields: [
        { key: 'from', type: 'Time', defaultValue: { type: 'literal', value: '06:30' } },
      ],
    })

    const invalid = compileFilterSource(`
defineFilter({
  fields: {
    from: field('Time').default(630),
  },
  outputs: {},
})
`)

    expect(invalid.artifact).toBeNull()
    expect(invalid.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'source-field-default-type' }),
    ]))
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

  it('compiles Query props/body and output graph', () => {
    const result = compileQuerySource(`
defineQuery({
  kind: 'rest',
  props: defineProps({
    filterPayload: field('Object').optional(),
  }),
  request: {
    method: 'POST',
    endpoint: env('API'),
    path: '/search',
    body: body(({ prop }) => merge({ limit: 500 }, prop('filterPayload'))),
  },
  outputs: {
    rows: output().from(response('items')),
  },
})
`)
    expect(result.diagnostics).toEqual([])
    expect(result.artifact).toMatchObject({
      props: [{ key: 'filterPayload' }],
      requestBody: { type: 'operation', operation: 'merge' },
    })
  })

  it('compiles props in every runtime request field', () => {
    const result = compileQuerySource(`
defineQuery({
  kind: 'rest',
  props: defineProps({
    endpoint: field('String'),
    path: field('String'),
    method: field('String'),
    tenant: field('String'),
    auth: field('Object'),
    timeoutMs: field('Number'),
    formUrlencoded: field('Boolean'),
    payload: field('Object'),
  }),
  request: {
    endpoint: prop('endpoint'),
    path: prop('path'),
    method: prop('method'),
    headers: { Accept: 'application/json', 'X-Tenant': prop('tenant') },
    auth: prop('auth'),
    timeoutMs: prop('timeoutMs'),
    formUrlencoded: prop('formUrlencoded'),
    body: body(({ prop }) => prop('payload')),
  },
  outputs: { raw: output().from(response()) },
})
`)

    expect(result.diagnostics).toEqual([])
    expect(result.artifact).toMatchObject({
      endpoint: { type: 'read', source: 'prop', path: 'endpoint' },
      query: { type: 'read', source: 'prop', path: 'path' },
      method: { type: 'read', source: 'prop', path: 'method' },
      headers: {
        type: 'object',
        properties: {
          Accept: { type: 'literal', value: 'application/json' },
          'X-Tenant': { type: 'read', source: 'prop', path: 'tenant' },
        },
      },
      auth: { type: 'read', source: 'prop', path: 'auth' },
      timeoutMs: { type: 'read', source: 'prop', path: 'timeoutMs' },
      sendAsFormUrlencoded: { type: 'read', source: 'prop', path: 'formUrlencoded' },
      requestBody: { type: 'read', source: 'prop', path: 'payload' },
    })
  })

  it('rejects an undeclared prop in any request field', () => {
    const result = compileQuerySource(`
defineQuery({
  kind: 'rest',
  props: defineProps({}),
  request: { endpoint: prop('missing') },
  outputs: {},
})
`)

    expect(result.artifact).toBeNull()
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'query-source-request-prop-missing',
        sourcePath: 'request.endpoint',
      }),
    ]))
  })

  it('compiles env bindings passed from Composition to Query props', () => {
    const result = compileCompositionSource(`
defineComposition({
  runtimes: {
    query: query('schedule').withProps({ endpoint: env('ENDPOINT_AODB') }),
  },
})
`)

    expect(result.diagnostics).toEqual([])
    expect(result.artifact?.runtimes[0]?.props.endpoint).toEqual({
      kind: 'expression',
      expression: { type: 'read', source: 'env', path: 'ENDPOINT_AODB' },
    })
  })

  it('compiles Composition graph and rejects cycles, duplicate persist keys and render config', () => {
    const valid = compileCompositionSource(`
	defineComposition({
	  data: {},
	  runtimes: {
	    filter: filter('schedule').persist({ key: 'schedule' }),
	    dateFilter: filterView('filter')
        .fields(['from'])
	      .controls({ from: control('Input') })
	      .withProps({
	        showLabels: true,
	        labels: { from: 'Дата вылета' },
	        requestPreview: fromOutput('filter', 'request'),
	      }),
	    allFilters: filterView('filter'),
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
	    expect(valid.artifact?.graph).toMatchObject({
	      updates: [{ sourceRuntime: 'filter', sourceOutput: 'request', targetRuntime: 'query', updateKind: 'run', debounceMs: 200 }],
	      mounts: [{ targetRuntime: 'query', updateKind: 'run' }],
	    })
	    expect(valid.artifact?.runtimes.find(runtime => runtime.name === 'dateFilter')).toMatchObject({
	      kind: 'filter-view',
	      identity: 'filter',
	      fields: ['from'],
	      controls: { from: { type: 'Input' } },
	      props: {
	        showLabels: { kind: 'literal', value: true },
	        labels: { kind: 'literal', value: { from: 'Дата вылета' } },
	        requestPreview: { kind: 'output', runtime: 'filter', output: 'request' },
	      },
	    })
	    expect(valid.artifact?.runtimes.find(runtime => runtime.name === 'allFilters')).toMatchObject({
	      kind: 'filter-view',
	      identity: 'filter',
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

  it('compiles optional custom component construction for Filter view', () => {
    const result = compileCompositionSource(`
defineComposition({
  runtimes: {
    filter: filter('schedule'),
    filters: filterView('filter')
      .fields(['search'])
      .component('schedule-filter-sfc'),
  },
})
`)

    expect(result.diagnostics).toEqual([])
    expect(result.artifact?.runtimes[1]).toMatchObject({
      kind: 'filter-view',
      identity: 'filter',
      fields: ['search'],
      componentIdentity: 'schedule-filter-sfc',
    })
  })

  it('compiles nested Composition runtimes and keeps their props explicit', () => {
    const valid = compileCompositionSource(`
defineComposition({
  data: {
    db: store('groundhandling-db'),
  },
  runtimes: {
    requests: composition('groundhandling-default')
      .storeTo(data('db'), {
        'raw.pairsArrival': output('arrivalPairs'),
        'raw.pairsDeparture': output('departurePairs'),
      }),
    table: component('groundhandling-table').withProps({
      rows: fromOutput('requests', 'arrivalPairs')
        .concat(fromOutput('requests', 'departurePairs'))
        .uniqBy(get('id')),
    }),
  },
  outputs: {
    rows: output().fromRuntime('requests').select('arrivalPairs'),
  },
})
`)

    expect(valid.diagnostics).toEqual([])
    expect(valid.artifact?.runtimes[0]).toMatchObject({
      name: 'requests',
      kind: 'composition',
      identity: 'groundhandling-default',
      storeTo: [{
        data: 'db',
        fields: {
          'raw.pairsArrival': 'arrivalPairs',
          'raw.pairsDeparture': 'departurePairs',
        },
      }],
    })
    expect(valid.artifact?.graph.publications).toHaveLength(2)

    const withProps = compileCompositionSource(`
defineComposition({
  runtimes: {
    requests: composition('groundhandling-default').withProps({ value: 1 }),
  },
})
`)
    expect(withProps.diagnostics).toEqual([])
    expect(withProps.artifact?.runtimes[0]?.props.value).toEqual({ kind: 'literal', value: 1 })
  })

  it('compiles public Composition props and explicit nested prop bindings', () => {
    const provider = compileCompositionSource(`
defineComposition({
  props: defineProps({
    requirements: field('Object'),
  }),
  runtimes: {
    attributes: query('attributes-leg-select').withProps({
      names: prop('requirements.arrival.attributes'),
    }),
  },
})
`)

    expect(provider.diagnostics).toEqual([])
    expect(provider.artifact?.props).toEqual([
      { key: 'requirements', type: 'Object', optional: false, array: false },
    ])
    expect(provider.artifact?.runtimes[0]?.props.names).toEqual({
      kind: 'expression',
      expression: {
        type: 'read',
        source: 'prop',
        path: 'requirements.arrival.attributes',
      },
    })

    const consumer = compileCompositionSource(`
defineComposition({
  runtimes: {
    requests: composition('groundhandling-default').withProps({
      requirements: metadataOf('table', 'groundhandling.query'),
    }),
    table: component('groundhandling-control-table'),
  },
})
`)

    expect(consumer.diagnostics).toEqual([])
    expect(consumer.artifact?.runtimes[0]?.props.requirements).toMatchObject({
      kind: 'runtime-metadata',
      runtime: 'table',
      namespace: 'groundhandling.query',
    })
  })

  it('compiles contextual Store policies and explicit nested data bindings', () => {
    const result = compileCompositionSource(`
defineComposition({
  data: {
    shared: store('schedule').slot('primary'),
    draft: store('schedule').isolated().slot('draft'),
    session: store('session').injected(),
  },
  runtimes: {
    board: composition('flight-board').withData({
      schedule: data('shared'),
    }),
  },
})
`)

    expect(result.diagnostics).toEqual([])
    expect(result.artifact?.data).toEqual([
      { name: 'shared', kind: 'store', identity: 'schedule', resolution: 'contextual', slot: 'primary' },
      { name: 'draft', kind: 'store', identity: 'schedule', resolution: 'isolated', slot: 'draft' },
      { name: 'session', kind: 'store', identity: 'session', resolution: 'injected' },
    ])
    expect(result.artifact?.runtimes[0]?.dataBindings).toEqual({ schedule: 'shared' })
    expect(result.artifact?.graph.dataInputs).toEqual([
      { targetRuntime: 'board', targetData: 'schedule', sourceData: 'shared' },
    ])

    const invalid = compileCompositionSource(`
defineComposition({
  data: {
    schedule: store('schedule').isolated().injected(),
  },
  runtimes: {
    board: composition('flight-board').withData({
      schedule: data('missing'),
    }),
  },
})
`)
    expect(invalid.artifact).toBeNull()
    expect(invalid.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'composition-data-resolution-conflict' }),
      expect.objectContaining({ code: 'composition-with-data-source-missing' }),
    ]))
  })

  it('compiles data, storeTo and fromData with optional outputs', () => {
    const result = compileCompositionSource(`
defineComposition({
  data: {
    schedule: store('schedule'),
  },
  runtimes: {
    query: query('schedule-query')
      .storeTo(data('schedule'), {
        raw: output('raw'),
      }),
    table: component('schedule-table')
      .withProps({
        rows: fromData('schedule.table'),
      }),
  },
  hooks: [
    onMount().run('query'),
  ],
})
`)

    expect(result.diagnostics).toEqual([])
    expect(result.artifact).toMatchObject({
      data: [{ name: 'schedule', kind: 'store', identity: 'schedule' }],
      runtimes: [
        {
          name: 'query',
          storeTo: [{ data: 'schedule', fields: { raw: 'raw' } }],
        },
        {
          name: 'table',
          props: { rows: { kind: 'data', data: 'schedule', path: 'table' } },
        },
      ],
      outputs: [],
	      graph: {
	        publications: [{ sourceRuntime: 'query', sourceOutput: 'raw', targetData: 'schedule', targetPath: 'raw' }],
	      },
    })
  })
})
