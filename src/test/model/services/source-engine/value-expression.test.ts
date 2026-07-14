import type * as t from '@babel/types'

import { parseExpression } from '@babel/parser'
import { describe, expect, it } from 'vitest'

import { compileValueExpression } from '@/model/services/source-engine/compilers/source-expression-compile'
import { evaluateValueExpression } from '@/model/services/source-engine/source-expression-evaluate'
import { compileQuerySource } from '@/model/services/source-engine/compilers/query-source-compile'
import { compileCompositionSource } from '@/model/services/source-engine/compilers/composition-source-compile'
import { compileDataViewSource } from '@/model/services/source-engine/compilers/data-view-source-compile'
import { EndgeDataView } from '@/model/endge/runtime/execution/endge-data-view'
import { QueryExecutor } from '@/model/services/query/QueryExecutor'

function compile(source: string) {
  const diagnostics: any[] = []
  const expression = compileValueExpression(
    parseExpression(source, { plugins: ['typescript'] }) as t.Expression,
    diagnostics,
    'test',
  )
  expect(diagnostics).toEqual([])
  expect(expression).not.toBeNull()
  return expression!
}

describe('ValueExpression', () => {
  it('is available in DataView map expressions while structural steps stay domain-specific', () => {
    const source = `
defineDataView({
  mode: 'pipeline',
  steps: [
    from('').as('row'),
    map({
      activeIds: path('row.items').where(match({ active: true })).sortBy(get('name')).map(get('id')),
      title: path('row.title').trim().defaultTo('Untitled'),
    }),
  ],
})
`
    const result = compileDataViewSource(source)

    expect(result.diagnostics).toEqual([])
    const mapStep = result.document?.steps?.find(step => step.type === 'map')
    expect(mapStep).toMatchObject({
      type: 'map',
      fields: {
        activeIds: { type: 'operation', operation: 'map' },
        title: { type: 'operation', operation: 'default-to' },
      },
    })

    expect(new EndgeDataView().runSource(source, [{
      title: '  Board  ',
      items: [
        { id: 2, name: 'Zulu', active: true },
        { id: 1, name: 'Alpha', active: true },
        { id: 3, name: 'Hidden', active: false },
      ],
    }])).toEqual([{ activeIds: [1, 2], title: 'Board' }])
  })

  it('compiles Composition bindings with domain readers and common chains', () => {
    const result = compileCompositionSource(`
defineComposition({
  data: {},
  runtimes: {
    filter: filter('schedule'),
    query: query('search').withProps({
      ids: fromOutput('filter', 'request').get('rows').where(match({ active: true })).map(get('id')),
      columns: metadata('component-sfc', 'flight-table').getOr('columns', []).where(match({ request: true })),
      pairs: fullJoin(
        fromOutput('filter', 'arrivalPairs'),
        fromOutput('filter', 'departurePairs'),
      )
        .byAny('arrivalLeg.id', 'departureLeg.id')
        .coalesce()
        .enrich('arrivalLeg', {
          attributes: lookupOne(fromOutput('filter', 'attributes')).by('legId').getOr('items', []),
        }),
    }),
  },
  hooks: [],
  outputs: {},
})
`)

    expect(result.diagnostics).toEqual([])
    expect(result.artifact?.runtimes.find(runtime => runtime.name === 'query')?.props).toMatchObject({
      ids: { kind: 'expression', expression: { type: 'operation', operation: 'map' } },
      columns: { kind: 'expression', expression: { type: 'operation', operation: 'where' } },
      pairs: { kind: 'expression', expression: { type: 'operation', operation: 'enrich' } },
    })
  })

  it('is available in Query request payload and response outputs', () => {
    const result = compileQuerySource(`
defineQuery({
  kind: 'rest',
  props: defineProps({ rows: field('Object') }),
  request: {
    endpoint: '/api',
    path: '/flights',
    method: 'POST',
    body: body(() => prop('rows').where(match({ active: true })).map(get('id'))),
  },
  outputs: {
    active: output().from(response('items').where(match({ active: true })).sortBy(get('std'))),
    pairs: output().from(
      fullJoin(
        response('pairsArrival'),
        response('pairsDeparture'),
      )
        .byAny('arrivalLeg.id', 'departureLeg.id')
        .coalesce()
        .enrich('arrivalLeg', {
          attributes: lookupOne(response('attributes')).by('legId').getOr('items', []),
        })
    ),
  },
})
`)

    expect(result.diagnostics).toEqual([])
    expect(result.artifact?.requestBody).toMatchObject({ type: 'operation', operation: 'map' })
    expect(result.artifact?.outputs[0]?.source).toMatchObject({
      type: 'response',
      expression: { type: 'operation', operation: 'sort-by' },
    })
    expect(new QueryExecutor().readResponseOutput(result.artifact!.outputs[0], {
      items: [
        { id: 2, active: true, std: '12:00' },
        { id: 3, active: false, std: '09:00' },
        { id: 1, active: true, std: '10:00' },
      ],
    })).toEqual([
      { id: 1, active: true, std: '10:00' },
      { id: 2, active: true, std: '12:00' },
    ])

    expect(new QueryExecutor().readResponseOutput(result.artifact!.outputs[1], {
      pairsArrival: [{ id: 'A-null', arrivalLeg: { id: 'A' } }],
      pairsDeparture: [{ id: 'A-D', arrivalLeg: { id: 'A' }, departureLeg: { id: 'D' } }],
      attributes: [{ legId: 'A', items: [{ name: 'BestOn' }] }],
    })).toEqual([
      {
        id: 'A-null',
        arrivalLeg: { id: 'A', attributes: [{ name: 'BestOn' }] },
        departureLeg: { id: 'D' },
      },
    ])
  })

  it('compiles and evaluates immutable dot chains', () => {
    const expression = compile(`
prop('flights')
  .where(and(inList(get('status'), ['active']), gt(get('delay'), 5)))
  .sortBy(get('std'))
  .map(pick(['id', 'status']))
`)

    expect(evaluateValueExpression(expression, {
      props: {
        flights: [
          { id: 2, status: 'active', delay: 8, std: '12:00' },
          { id: 1, status: 'active', delay: 10, std: '10:00' },
          { id: 3, status: 'cancelled', delay: 20, std: '09:00' },
        ],
      },
    })).toEqual([
      { id: 1, status: 'active' },
      { id: 2, status: 'active' },
    ])
  })

  it('supports object, collection, aggregate and string operations from one registry', () => {
    const expression = compile(`
prop('rows')
  .uniqBy(get('id'))
  .groupBy(get('type'))
  .get('A')
  .sumBy(get('amount'))
`)

    expect(evaluateValueExpression(expression, {
      props: {
        rows: [
          { id: 1, type: 'A', amount: 2 },
          { id: 1, type: 'A', amount: 2 },
          { id: 2, type: 'A', amount: 3 },
          { id: 3, type: 'B', amount: 8 },
        ],
      },
    })).toBe(5)

    expect(evaluateValueExpression(compile(`prop('name').trim().lowerCase().split(' ').join('-')`), {
      props: { name: '  Hello World  ' },
    })).toBe('hello-world')
  })

  it('keeps legacy pick(path) behavior and supports pick(keys)', () => {
    expect(evaluateValueExpression(compile(`prop('row').pick('nested.value')`), {
      props: { row: { nested: { value: 42 } } },
    })).toBe(42)

    expect(evaluateValueExpression(compile(`prop('row').pick(['id'])`), {
      props: { row: { id: 1, name: 'Flight' } },
    })).toEqual({ id: 1 })
  })

  it('supports relational joins with alternative keys and record coalescing', () => {
    const expression = compile(`
fullJoin(prop('arrival'), prop('departure'))
  .byAny('arrivalLeg.id', 'departureLeg.id')
  .coalesce({ prefer: 'right' })
`)

    expect(evaluateValueExpression(expression, {
      props: {
        arrival: [
          { id: 'A-null', arrivalLeg: { id: 'A' } },
          { id: 'B-null', arrivalLeg: { id: 'B' } },
        ],
        departure: [
          { id: 'A-D', arrivalLeg: { id: 'A' }, departureLeg: { id: 'D' } },
          { id: 'X-Y', arrivalLeg: { id: 'X' }, departureLeg: { id: 'Y' } },
        ],
      },
    })).toEqual([
      { id: 'A-D', arrivalLeg: { id: 'A' }, departureLeg: { id: 'D' } },
      { id: 'B-null', arrivalLeg: { id: 'B' } },
      { id: 'X-Y', arrivalLeg: { id: 'X' }, departureLeg: { id: 'Y' } },
    ])

    const mappedKey = compile(`leftJoin(prop('rows'), prop('attrs')).by({ left: 'id', right: 'legId' })`)
    expect(evaluateValueExpression(mappedKey, {
      props: {
        rows: [{ id: 'A' }, { id: 'B' }],
        attrs: [{ legId: 'A', value: 1 }],
      },
    })).toEqual([
      { left: { id: 'A' }, right: { legId: 'A', value: 1 } },
      { left: { id: 'B' }, right: null },
    ])

    const warnings: any[] = []
    const ambiguous = compile(`fullJoin(prop('left'), prop('right')).byAny('id')`)
    expect(evaluateValueExpression(ambiguous, {
      props: {
        left: [{ id: 'A' }, {}],
        right: [{ id: 'A' }, { id: 'A' }, {}],
      },
      onWarning: warning => warnings.push(warning),
    })).toEqual([
      { left: { id: 'A' }, right: { id: 'A' } },
      { left: { id: 'A' }, right: { id: 'A' } },
      { left: {}, right: null },
      { left: null, right: {} },
    ])
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'value-expression-join-ambiguous' }),
    ])
  })

  it('enriches existing branches through indexed one-to-one and one-to-many lookups', () => {
    const expression = compile(`
fullJoin('pairsArrival', 'pairsDeparture')
  .byAny('arrivalLeg.id', 'departureLeg.id')
  .coalesce()
  .enrich('arrivalLeg', {
    attributes: lookupOne('attributes').by('legId').getOr('items', []),
    activities: lookupMany('activities').by({ source: 'legId', target: 'id' }),
  })
  .enrich('departureLeg', {
    attributes: lookupOne('attributes').by('legId').getOr('items', []),
  })
`)
    const scope = {
      pairsArrival: [
        { id: 'A-null', arrivalLeg: { id: 'A', carrier: 'SU' } },
        { id: 'B-null', arrivalLeg: { id: 'B', carrier: 'SU' } },
      ],
      pairsDeparture: [
        { id: 'A-D', arrivalLeg: { id: 'A' }, departureLeg: { id: 'D', carrier: 'SU' } },
        { id: 'X-Y', arrivalLeg: { id: 'X' }, departureLeg: { id: 'Y' } },
      ],
      attributes: [
        { legId: 'A', items: [{ code: 'stand', value: '101' }] },
        { legId: 'D', items: [{ code: 'gate', value: '12' }] },
      ],
      activities: [
        { id: 1, legId: 'A', code: 'tow' },
        { id: 2, legId: 'A', code: 'pushback' },
      ],
    }

    expect(evaluateValueExpression(expression, { scope })).toEqual([
      {
        id: 'A-null',
        arrivalLeg: {
          id: 'A',
          carrier: 'SU',
          attributes: [{ code: 'stand', value: '101' }],
          activities: [
            { id: 1, legId: 'A', code: 'tow' },
            { id: 2, legId: 'A', code: 'pushback' },
          ],
        },
        departureLeg: {
          id: 'D',
          carrier: 'SU',
          attributes: [{ code: 'gate', value: '12' }],
        },
      },
      {
        id: 'B-null',
        arrivalLeg: { id: 'B', carrier: 'SU', attributes: [], activities: [] },
      },
      {
        id: 'X-Y',
        arrivalLeg: { id: 'X', attributes: [], activities: [] },
        departureLeg: { id: 'Y', attributes: [] },
      },
    ])

    expect(scope.pairsArrival[0]).toEqual({ id: 'A-null', arrivalLeg: { id: 'A', carrier: 'SU' } })
    expect(scope.pairsDeparture[0]).toEqual({
      id: 'A-D',
      arrivalLeg: { id: 'A' },
      departureLeg: { id: 'D', carrier: 'SU' },
    })
  })

  it('warns once when lookupOne finds duplicate records for one key', () => {
    const warnings: any[] = []
    const expression = compile(`
prop('rows').enrich('leg', {
  attributes: lookupOne(prop('attributes')).by('legId').getOr('items', []),
})
`)

    expect(evaluateValueExpression(expression, {
      props: {
        rows: [{ leg: { id: 'A' } }, { leg: { id: 'A' } }],
        attributes: [
          { legId: 'A', items: [1] },
          { legId: 'A', items: [2] },
        ],
      },
      onWarning: warning => warnings.push(warning),
    })).toEqual([
      { leg: { id: 'A', attributes: [1] } },
      { leg: { id: 'A', attributes: [1] } },
    ])
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'value-expression-lookup-ambiguous' }),
    ])
  })
})
