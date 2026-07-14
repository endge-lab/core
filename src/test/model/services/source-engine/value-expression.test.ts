import type * as t from '@babel/types'

import { parseExpression } from '@babel/parser'
import { describe, expect, it } from 'vitest'

import { compileValueExpression } from '@/model/services/source-engine/source-expression-compile'
import { evaluateValueExpression } from '@/model/services/source-engine/source-expression-evaluate'
import { compileQuerySource } from '@/model/services/source-engine/query-source-compile'
import { compileCompositionSource } from '@/model/services/source-engine/composition-source-compile'
import { compileDataViewSource } from '@/model/services/source-engine/data-view-source-compile'
import { EndgeDataView } from '@/model/endge/runtime/execution/endge-data-view'
import { QueryExecutor_Service } from '@/model/services/QueryExecutor_Service'

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
  },
})
`)

    expect(result.diagnostics).toEqual([])
    expect(result.artifact?.requestBody).toMatchObject({ type: 'operation', operation: 'map' })
    expect(result.artifact?.outputs[0]?.source).toMatchObject({
      type: 'response',
      expression: { type: 'operation', operation: 'sort-by' },
    })
    expect(new QueryExecutor_Service().readResponseOutput(result.artifact!.outputs[0], {
      items: [
        { id: 2, active: true, std: '12:00' },
        { id: 3, active: false, std: '09:00' },
        { id: 1, active: true, std: '10:00' },
      ],
    })).toEqual([
      { id: 1, active: true, std: '10:00' },
      { id: 2, active: true, std: '12:00' },
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
})
