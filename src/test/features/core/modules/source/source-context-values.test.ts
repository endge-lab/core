import type * as t from '@babel/types'
import type { SourceContextValues } from '@/features/core/modules/source/domain/types/source-context.types'

import { parseExpression } from '@babel/parser'
import { describe, expect, it, vi } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'
import { EndgeDataView } from '@/features/core/modules/runtime/execution/endge-data-view'
import { compileCompositionSource } from '@/features/core/modules/source/services/compilers/composition-source-compile'
import { compileDataViewSource } from '@/features/core/modules/source/services/compilers/data-view-source-compile'
import { compileQuerySource } from '@/features/core/modules/source/services/compilers/query-source-compile'
import { compileValueExpression } from '@/features/core/modules/source/services/compilers/source-expression-compile'
import { runWithSourceContext, selectContextCase } from '@/features/core/modules/source/services/source-context'
import { evaluateValueExpression } from '@/features/core/modules/source/services/source-expression-evaluate'
import { createQueryExecutor } from '@/test/helpers/query-executor'

const AFL: SourceContextValues = {
  facets: { tenant: 'afl', stage: 'production' },
  config: { inspector: { endpoint: '/afl/flights', fields: ['id', 'gate'], limits: { page: 50 } }, defaultLocale: 'ru' },
}
const KZN: SourceContextValues = {
  facets: { tenant: 'kzn' },
  config: { inspector: { endpoint: '/kzn/flights', fields: ['id', 'stand'], limits: { page: 20 } }, defaultLocale: 'ru' },
}

function compile(source: string, context?: SourceContextValues) {
  const diagnostics: any[] = []
  const expression = runWithSourceContext(context, () => compileValueExpression(
    parseExpression(source, { plugins: ['typescript'] }) as t.Expression,
    diagnostics,
    'test',
  ))
  return { expression, diagnostics }
}

function value(source: string, context?: SourceContextValues) {
  const result = compile(source, context)
  expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
  return evaluateValueExpression(result.expression!)
}

const TENANT_SWITCH = `contextSwitch({
  default: 'base',
  cases: [
    { when: { tenant: 'afl' }, use: 'afl' },
    { when: { tenant: 'afl', stage: 'production' }, use: concat('afl-', toString(config('inspector.limits.page'))) },
    { when: { tenant: 'kzn' }, use: { region: 'volga', page: config('inspector.limits.page') } },
  ],
})`

describe('значения контекста сборки в выражениях Source', () => {
  it('подставляет facet(), config() и context() константами при компиляции', () => {
    expect(compile(`facet('tenant')`, AFL).expression).toEqual({ type: 'literal', value: 'afl' })
    expect(value(`facet('stage')`, KZN)).toBeNull()
    expect(value(`config('inspector.endpoint')`, KZN)).toBe('/kzn/flights')
    expect(value(`config('inspector.fields[1]')`, AFL)).toBe('gate')
    expect(value(`config('inspector.limits')`, AFL)).toEqual({ page: 50 })
    expect(value(`config('missing.key')`, AFL)).toBeUndefined()
    expect(value(`context({ tenant: 'afl' })`, AFL)).toBe(true)
    expect(value(`context({ tenant: 'afl', stage: 'production' })`, AFL)).toBe(true)
    expect(value(`context({ tenant: 'afl', stage: 'test' })`, AFL)).toBe(false)
    expect(value(`context({ tenant: 'afl' })`, KZN)).toBe(false)
    expect(value(`when(context({ tenant: 'kzn' }), config('inspector.limits.page'), 100)`, KZN)).toBe(20)
    expect(value(`concat(facet('tenant'), ':', 'x')`, KZN)).toBe('kzn:x')
  })

  it('не отдаёт наружу замороженный snapshot Configuration и копирует значение на каждое вычисление', () => {
    const frozen: SourceContextValues = { facets: {}, config: Object.freeze({ list: Object.freeze([1, 2]) }) }
    const { expression } = compile(`config('list')`, frozen)
    const first = evaluateValueExpression(expression!) as number[]
    first.push(3)
    expect(evaluateValueExpression(expression!)).toEqual([1, 2])
  })

  it('выбирает в contextSwitch значений наиболее специфичный case, иначе default', () => {
    expect(value(TENANT_SWITCH, AFL)).toBe('afl-50')
    expect(value(TENANT_SWITCH, { ...AFL, facets: { tenant: 'afl' } })).toBe('afl')
    expect(value(TENANT_SWITCH, KZN)).toEqual({ region: 'volga', page: 20 })
    expect(value(TENANT_SWITCH, { facets: { tenant: 'svo' }, config: {} })).toBe('base')
    expect(value(`contextSwitch({ default: 1, cases: [] }).toString()`, AFL)).toBe('1')
    expect(value(`contextSwitch({ default: prop('a'), cases: [{ when: { tenant: 'kzn' }, use: row('b') }] })`, KZN)).toBeUndefined()
    expect(selectContextCase([{ when: { a: '1' } }, { when: { a: '1', b: '2' } }], { a: '1', b: '2' })).toBe(1)
  })

  it('компилирует и проверяет все ветки contextSwitch, включая невыбранные', () => {
    const result = compile(`contextSwitch({
      default: 'base',
      cases: [
        { when: { tenant: 'kzn' }, use: response('legs[*]') },
        { when: { tenant: 'svo' }, use: unknownCall() },
      ],
    })`, AFL)
    expect(result.expression).toEqual({ type: 'literal', value: 'base' })
    expect(result.diagnostics.map(item => [item.code, item.sourcePath])).toEqual([
      ['source-expression-path-wildcard', 'test.contextSwitch.cases.0.use'],
      ['source-expression-unsupported', 'test.contextSwitch.cases.1.use'],
    ])
  })

  it('сообщает об ошибках формы contextSwitch, context(), facet() и config()', () => {
    const codes = (source: string) => compile(source, AFL).diagnostics.map(item => item.code)
    expect(codes(`contextSwitch({ cases: [] })`)).toEqual(['source-expression-context-switch-default-required'])
    expect(codes(`contextSwitch({ default: 1 })`)).toEqual(['source-expression-context-switch-cases-shape'])
    expect(codes(`contextSwitch('x')`)).toEqual(['source-expression-context-switch-shape'])
    expect(codes(`contextSwitch({ default: 1, cases: [], other: 2 })`)).toEqual(['source-expression-context-switch-property'])
    expect(codes(`contextSwitch({ default: 1, cases: [{ when: {}, use: 2 }] })`)).toEqual(['source-expression-context-switch-when-empty'])
    expect(codes(`contextSwitch({ default: 1, cases: [{ when: { tenant: 'kzn' } }] })`)).toEqual(['source-expression-context-switch-use-required'])
    expect(codes(`contextSwitch({ default: 1, cases: [{ when: { tenant: 1 }, use: 2 }] })`)).toEqual([
      'source-expression-context-switch-when-entry',
      'source-expression-context-switch-when-empty',
    ])
    expect(codes(`contextSwitch({ default: 1, cases: [{ when: 'kzn', use: 2, extra: 3 }] })`)).toEqual([
      'source-expression-context-switch-case-shape',
      'source-expression-context-switch-when-shape',
    ])
    expect(codes(`contextSwitch({
      default: 1,
      cases: [
        { when: { tenant: 'kzn' }, use: 2 },
        { when: { stage: 'test' }, use: 3 },
        { when: { tenant: 'afl' }, use: 4 },
      ],
    })`)).toEqual(['source-expression-context-switch-ambiguous', 'source-expression-context-switch-ambiguous'])
    expect(codes(`context({})`)).toEqual(['source-expression-context-empty'])
    expect(codes(`context('kzn')`)).toEqual(['source-expression-context-shape'])
    expect(codes(`context({ tenant: 'kzn', tenant: 'afl' })`)).toEqual(['source-expression-context-duplicate'])
    expect(codes(`context({ tenant: 1, stage: 'prod' })`)).toEqual(['source-expression-context-entry'])
    expect(codes(`contextSwitch({ default: 1, cases: [{ when: { tenant: 'kzn', tenant: 'afl' }, use: 2 }] })`)).toEqual([
      'source-expression-context-switch-when-duplicate',
    ])
    expect(codes(`facet()`)).toEqual(['source-expression-facet-argument'])
    expect(codes(`facet(prop('name'))`)).toEqual(['source-expression-facet-argument'])
    expect(codes(`config('')`)).toEqual(['source-expression-config-argument'])
    expect(codes(`config('items[*]')`)).toEqual(['source-expression-path-wildcard'])
  })

  it('принимает явный sourceContext в Endge.source.compile', () => {
    const source = `defineDataView({ mode: 'projection', output: { tenant: facet('tenant') } })`
    const result = Endge.source.compile('data-view', source, { sourceContext: KZN })
    expect(result.diagnostics).toEqual([])
    expect(result.artifact.output).toEqual({ tenant: { type: 'literal', value: 'kzn' } })
    expect(Endge.source.compile('data-view', source).diagnostics).toEqual([
      expect.objectContaining({ severity: 'info', code: 'source-expression-context-unbound' }),
    ])
  })

  it('вне контекста сборки подставляет значения по умолчанию с info-диагностикой', () => {
    const result = compile(`[facet('tenant'), config('inspector.endpoint'), context({ tenant: 'afl' }), ${TENANT_SWITCH}]`)
    expect(evaluateValueExpression(result.expression!)).toEqual([null, undefined, false, 'base'])
    expect(result.diagnostics.map(item => [item.severity, item.code, item.sourcePath])).toEqual([
      ['info', 'source-expression-context-unbound', 'test.0'],
    ])
  })
})

describe('контекст сборки в Query, DataView и Composition', () => {
  const REST_QUERY = `
defineQuery({
  kind: 'rest',
  props: defineProps({ id: field('String') }),
  request: {
    endpoint: 'https://ops.example.test',
    path: concat(config('inspector.endpoint'), '/', prop('id')),
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'X-Tenant': facet('tenant'),
      'X-Mode': contextSwitch({ default: 'read', cases: [{ when: { tenant: 'kzn' }, use: 'legacy' }] }),
    },
    body: body(({ prop }) => ({
      id: prop('id'),
      fields: config('inspector.fields'),
      strict: context({ tenant: 'afl' }),
    })),
  },
  outputs: {
    gate: output().from(contextSwitch({ default: response('flight.gate'), cases: [{ when: { tenant: 'kzn' }, use: response('flight.stand') }] })),
    label: output().from(contextSwitch({
      default: response('flight.gate'),
      cases: [{ when: { tenant: 'kzn' }, use: concat(facet('tenant'), ':', response('flight.stand')) }],
    })),
  },
})
`

  it('подставляет значения в REST path, headers, body и outputs по выбранному тенанту', async () => {
    for (const [context, expected] of [
      [AFL, { url: 'https://ops.example.test/afl/flights/L1', mode: 'read', tenant: 'afl', fields: ['id', 'gate'], strict: true, outputs: ['A1', 'A1'] }],
      [KZN, { url: 'https://ops.example.test/kzn/flights/L1', mode: 'legacy', tenant: 'kzn', fields: ['id', 'stand'], strict: false, outputs: ['S7', 'kzn:S7'] }],
    ] as const) {
      const compiled = runWithSourceContext(context, () => compileQuerySource(REST_QUERY))
      expect(compiled.diagnostics.filter(item => item.severity === 'error')).toEqual([])
      const request = vi.fn().mockResolvedValue({ data: { ok: true } })
      await createQueryExecutor({ request } as any).execute({ payload: compiled.artifact!, vars: { id: 'L1' } })
      expect(request).toHaveBeenCalledWith(expect.objectContaining({
        url: expected.url,
        headers: { 'Accept': 'application/json', 'X-Tenant': expected.tenant, 'X-Mode': expected.mode },
        data: { id: 'L1', fields: expected.fields, strict: expected.strict },
      }))
      const executor = createQueryExecutor()
      const response = { flight: { gate: 'A1', stand: 'S7' } }
      expect(compiled.artifact!.outputs.map(output => executor.readResponseOutput(output, response))).toEqual(expected.outputs)
    }
  })

  it('подставляет значения в variables GraphQL', async () => {
    const source = `
defineQuery({
  kind: 'graphql',
  props: defineProps({ id: field('String') }),
  request: {
    endpoint: 'https://graphql.example.test',
    document: gql\`query Flight($id: ID!, $tenant: String!, $page: Int) { flight(id: $id, tenant: $tenant, page: $page) { id } }\`,
    variables: variables(({ prop }) => ({
      id: prop('id'),
      tenant: facet('tenant'),
      page: contextSwitch({ default: 10, cases: [{ when: { tenant: 'kzn' }, use: config('inspector.limits.page') }] }),
    })),
    auth: { mode: 'none' },
  },
  outputs: { flight: output().from(data('flight')) },
})
`
    for (const [context, variables] of [
      [AFL, { id: 'L1', tenant: 'afl', page: 10 }],
      [KZN, { id: 'L1', tenant: 'kzn', page: 20 }],
    ] as const) {
      const compiled = runWithSourceContext(context, () => compileQuerySource(source))
      expect(compiled.diagnostics.filter(item => item.severity === 'error')).toEqual([])
      const request = vi.fn().mockResolvedValue({ data: { data: { flight: { id: 'L1' } } } })
      await createQueryExecutor({ request } as any).execute({ payload: compiled.artifact!, vars: { id: 'L1' } })
      expect(request).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ variables }),
      }))
    }
  })

  it('подставляет значения в projection и pipeline DataView, включая inline-компиляцию runSource', () => {
    const projection = `
defineDataView({
  mode: 'projection',
  output: {
    tenant: facet('tenant'),
    fields: config('inspector.fields'),
    title: contextSwitch({ default: path('name'), cases: [{ when: { tenant: 'kzn' }, use: concat('KZN ', path('name')) }] }),
  },
})
`
    const pipeline = `
defineDataView({
  mode: 'pipeline',
  steps: [
    from('legs').as('leg'),
    map({
      id: path('leg.id'),
      place: contextSwitch({ default: path('leg.gate'), cases: [{ when: { tenant: 'kzn' }, use: path('leg.stand') }] }),
    }),
  ],
})
`
    const input = { name: 'SU100', legs: [{ id: 'L1', gate: 'A1', stand: 'S7' }] }
    const dataView = new EndgeDataView()
    expect(runWithSourceContext(AFL, () => dataView.runSource(projection, input))).toEqual({ tenant: 'afl', fields: ['id', 'gate'], title: 'SU100' })
    expect(runWithSourceContext(KZN, () => dataView.runSource(projection, input))).toEqual({ tenant: 'kzn', fields: ['id', 'stand'], title: 'KZN SU100' })
    expect(runWithSourceContext(AFL, () => dataView.runSource(pipeline, input))).toEqual([{ id: 'L1', place: 'A1' }])
    expect(runWithSourceContext(KZN, () => dataView.runSource(pipeline, input))).toEqual([{ id: 'L1', place: 'S7' }])
    expect(runWithSourceContext(KZN, () => compileDataViewSource(pipeline)).diagnostics).toEqual([])
  })

  it('подставляет значения в props Composition рядом с contextSwitch ссылок', () => {
    const source = `
defineComposition({
  runtimes: {
    inspector: contextSwitch({
      default: query('flight'),
      cases: [{ when: { tenant: 'kzn' }, use: query('flight-kzn') }],
    }).withProps({
      tenant: facet('tenant'),
      page: contextSwitch({ default: 10, cases: [{ when: { tenant: 'kzn' }, use: config('inspector.limits.page') }] }),
    }),
  },
})
`
    const runtime = (context: SourceContextValues) => {
      const result = runWithSourceContext(context, () => compileCompositionSource(source, 1, context.facets))
      expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
      return result.artifact?.runtimes.find(item => item.name === 'inspector')
    }
    const literal = (value: unknown) => ({ kind: 'expression', expression: { type: 'literal', value } })
    expect(runtime(AFL)).toMatchObject({ identity: 'flight', props: { tenant: literal('afl'), page: literal(10) } })
    expect(runtime(KZN)).toMatchObject({ identity: 'flight-kzn', props: { tenant: literal('kzn'), page: literal(20) } })
  })
})
