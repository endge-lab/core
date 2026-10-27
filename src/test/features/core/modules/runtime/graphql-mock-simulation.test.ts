import type { ProgramArtifact, ProgramEntityType, QueryProgramPayload } from '@/features/core/modules/program/domain/types/program.types'
import type { SimulationGenerator } from '@/features/core/modules/runtime/domain/simulation-runtime.types'
import type { StreamTransportFactory } from '@/features/core/modules/runtime/domain/stream-runtime.types'
import type { QueryRuntimeHost } from '@/features/core/modules/runtime/hosts/QueryRuntimeHost'
import type { StreamRuntimeHost } from '@/features/core/modules/runtime/hosts/StreamRuntimeHost'
import type { CompositionProgramPayload } from '@/features/core/modules/source/domain/types/composition-source.types'
import type { SimulationMockStream, SimulationSourceArtifact } from '@/features/core/modules/source/domain/types/simulation-source.types'
import type { TypeProgramPayload } from '@/features/core/modules/source/domain/types/type-source.types'

import { Raph } from '@raphy-js/raph'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'
import { RComposition } from '@/features/core/modules/domain/entities/RComposition'
import { RQuery } from '@/features/core/modules/domain/entities/RQuery'
import { RSimulation } from '@/features/core/modules/domain/entities/RSimulation'
import { RStream } from '@/features/core/modules/domain/entities/RStream'
import { QueryExecutor_Adapter } from '@/features/core/modules/runtime/adapters/QueryExecutor_Adapter'
import { GraphQLQueryError } from '@/features/core/modules/runtime/domain/graphql-query-error'
import { compileQuerySource } from '@/features/core/modules/source/services/compilers/query-source-compile'
import { compileSimulationSource } from '@/features/core/modules/source/services/compilers/simulation-source-compile'
import { compileStreamSource } from '@/features/core/modules/source/services/compilers/stream-source-compile'
import { resolveSimulationResponseContract } from '@/features/core/modules/source/services/simulation-response-contract'
import { SimulationSourceResolver } from '@/features/core/modules/source/services/SimulationSourceResolver'

function ORDERS_QUERY(options: { errorPolicy?: string, mock?: string, outputs?: string } = {}) {
  return `defineQuery({
  kind: 'graphql',
  request: {
    endpoint: 'https://api.test/graphql',
    document: gql\`query Orders { orders { id status } meta { total } }\`,
    errorPolicy: '${options.errorPolicy ?? 'throw'}',
  },
  outputs: ${options.outputs ?? `{
    orders: output().from(data('orders')).contract(field('Order').array()),
    total: output().from(data('meta.total')).contract(field('Number')),
    problems: output().from(errors()),
  }`},
  ${options.mock ?? ''}
})`
}

const MOCK_ERRORS = `[{ message: 'Total is unavailable', path: ['meta', 'total'], extensions: { code: 'FORBIDDEN' } }]`
function MOCK(errors = MOCK_ERRORS) {
  return `mock: {
  enabled: true,
  data: { orders: [{ id: 'o-1', status: 'new' }], meta: { total: null } },
  errors: ${errors},
},`
}

function compileQuery(source: string): QueryProgramPayload {
  const result = compileQuerySource(source)
  expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
  return result.artifact!
}

function executor(reportGraphQLErrors = vi.fn()) {
  const request = vi.fn()
  const adapter = new QueryExecutor_Adapter({
    resolveVariable: source => source,
    resolveAuth: vi.fn(),
    reportWarning: vi.fn(),
    reportGraphQLErrors,
  }, { request } as any)
  return { adapter, request, reportGraphQLErrors }
}

async function readOutputs(adapter: QueryExecutor_Adapter, payload: QueryProgramPayload) {
  let errors: readonly unknown[] = []
  const response = await adapter.execute({ payload, onGraphQLErrors: (value) => {
    errors = value
  } })
  return Object.fromEntries(payload.outputs.map(output => [output.key, adapter.readResponseOutput(output, response, errors as any)]))
}

describe('mock GraphQL Query: data и errors', () => {
  it('компилирует mock.errors только для GraphQL и проверяет форму', () => {
    expect(compileQuery(ORDERS_QUERY({ mock: MOCK() })).mockErrors).toEqual([
      { message: 'Total is unavailable', path: ['meta', 'total'], extensions: { code: 'FORBIDDEN' } },
    ])
    // Прежний mock без errors не добавляет поле в artifact.
    expect(compileQuery(ORDERS_QUERY({ mock: 'mock: { enabled: true, data: { orders: [] } },' }))).not.toHaveProperty('mockErrors')
    for (const errors of ['{ message: \'x\' }', '[{ path: [\'a\'] }]', '[{ message: \'x\', path: \'a\' }]']) {
      expect(compileQuerySource(ORDERS_QUERY({ mock: MOCK(errors) })).diagnostics)
        .toContainEqual(expect.objectContaining({ code: 'query-source-mock-errors-shape', severity: 'error' }))
    }
    const rest = compileQuerySource(`defineQuery({
      request: { endpoint: 'https://api.test', path: '/orders', method: 'GET' },
      outputs: { rows: output().from(response()) },
      mock: { enabled: true, data: [], errors: [{ message: 'x' }] },
    })`)
    expect(rest.diagnostics).toContainEqual(expect.objectContaining({ code: 'query-source-mock-errors-rest', severity: 'error' }))
  })

  it('прежний mock с одним data работает как раньше: transport не вызывается, errors() пуст', async () => {
    const { adapter, request } = executor()
    const payload = compileQuery(ORDERS_QUERY({ errorPolicy: 'all', mock: 'mock: { enabled: true, data: { orders: [{ id: \'o-1\' }], meta: { total: 1 } } },' }))
    expect(await readOutputs(adapter, payload)).toEqual({ orders: [{ id: 'o-1' }], total: 1, problems: [] })
    expect(request).not.toHaveBeenCalled()
  })

  it('errorPolicy all: частичные data, errors в reader errors() и в diagnostics', async () => {
    const { adapter, request, reportGraphQLErrors } = executor()
    const outputs = await readOutputs(adapter, compileQuery(ORDERS_QUERY({ errorPolicy: 'all', mock: MOCK() })))
    expect(outputs).toEqual({
      orders: [{ id: 'o-1', status: 'new' }],
      total: null,
      problems: [{ message: 'Total is unavailable', path: ['meta', 'total'], extensions: { code: 'FORBIDDEN' } }],
    })
    expect(reportGraphQLErrors).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.test/graphql', errors: outputs.problems }))
    expect(request).not.toHaveBeenCalled()
  })

  it('errorPolicy ignore: data без errors', async () => {
    const { adapter, reportGraphQLErrors } = executor()
    const source = ORDERS_QUERY({
      errorPolicy: 'ignore',
      mock: MOCK(),
      outputs: '{ orders: output().from(data(\'orders\')), problems: output().from(errors()) }',
    })
    expect(await readOutputs(adapter, compileQuery(source))).toEqual({ orders: [{ id: 'o-1', status: 'new' }], problems: [] })
    expect(reportGraphQLErrors).not.toHaveBeenCalled()
  })

  it('errorPolicy throw: GraphQLQueryError с errors и частичными data, без console.error', async () => {
    const { adapter } = executor()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const payload = compileQuery(ORDERS_QUERY({ mock: MOCK(), outputs: '{ orders: output().from(data(\'orders\')) }' }))
    const error = await adapter.execute({ payload }).catch(caught => caught)
    expect(error).toBeInstanceOf(GraphQLQueryError)
    expect(error).toMatchObject({
      errors: [{ message: 'Total is unavailable', path: ['meta', 'total'] }],
      data: { orders: [{ id: 'o-1', status: 'new' }], meta: { total: null } },
      url: 'https://api.test/graphql',
    })
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

describe('контракт ответа Simulation для GraphQL Query', () => {
  const output = (path: string | null, type?: string, array = false) => ({
    source: { type: 'response' as const, path },
    transforms: [],
    contract: type ? { key: 'x', type, array, optional: false } : null,
  })

  it('собирает объект data из выходов data(\'...\') с контрактом', () => {
    const result = resolveSimulationResponseContract('orders', [output('orders', 'Order', true), output('meta.total', 'Number'), output('raw')], true)
    expect(result.contract).toEqual({
      type: 'Object',
      array: false,
      typeExpression: { kind: 'object', fields: [
        { key: 'meta', type: { kind: 'object', fields: [
          { key: 'total', type: { kind: 'reference', identity: 'Number' }, optional: false, array: false, examples: [] },
        ] }, optional: false, array: false, examples: [] },
        { key: 'orders', type: { kind: 'reference', identity: 'Order' }, optional: false, array: true, examples: [] },
      ] },
    })
  })

  it('корневой контракт data() имеет приоритет, как у REST; REST не собирает объект по путям', () => {
    expect(resolveSimulationResponseContract('orders', [output(null, 'Page'), output('orders', 'Order', true)], true).contract).toMatchObject({ type: 'Page' })
    expect(resolveSimulationResponseContract('rows', [output('orders', 'Order', true)], false).error).toContain('response()')
  })

  it('отклоняет конфликтующие, вложенные и индексные пути', () => {
    expect(resolveSimulationResponseContract('q', [output('a', 'Order'), output('a', 'Number')], true).error).toContain('разные контракты')
    expect(resolveSimulationResponseContract('q', [output('a', 'Order'), output('a.b', 'Number')], true).error).toContain('вложенного')
    expect(resolveSimulationResponseContract('q', [output('items.0', 'Order')], true).error).toContain('индексов')
    expect(resolveSimulationResponseContract('q', [output('a')], true).error).toContain('хотя бы для одного')
  })
})

const ORDER_TYPE = 'defineType({ id: field(ID), status: field(String) })'
const SSE_STREAM = `defineStream({
  transport: graphqlSse({
    url: 'https://api.test/graphql/stream',
    document: gql\`subscription OrderUpdated { orderUpdated { id status } }\`,
    errorPolicy: 'all',
  }),
  events: { next: event({ type: 'order.updated', payloadFrom: 'orderUpdated' }) },
})`
const PLAIN_STREAM = `defineStream({
  transport: sse({ url: 'https://api.test/stream' }),
  events: { message: event('quote.updated') },
})`

describe('simulation Source для GraphQL', () => {
  const resolver = new SimulationSourceResolver({
    compositions: [{ id: 'page-id', identity: 'page', sourceVersion: 1, source: 'defineComposition({ runtimes: { orders: query(\'orders\'), updates: stream(\'order-updates\'), quotes: stream(\'quotes\') } })' }],
    queries: [{ id: 'orders-id', identity: 'orders', sourceVersion: 2, source: ORDERS_QUERY() }],
    types: [
      { id: 'order-id', identity: 'Order', sourceVersion: 1, source: ORDER_TYPE },
      { id: 'order-event-id', identity: 'OrderUpdatedData', sourceVersion: 1, source: 'defineType({ orderUpdated: field(Order) })' },
      { id: 'number-id', identity: 'Number', sourceVersion: 1, source: '', isPrimitive: true },
      { id: 'id-id', identity: 'ID', sourceVersion: 1, source: '', isPrimitive: true },
      { id: 'string-id', identity: 'String', sourceVersion: 1, source: '', isPrimitive: true },
    ],
    streams: [
      { id: 'updates-id', identity: 'order-updates', sourceVersion: 1, source: SSE_STREAM },
      { id: 'quotes-id', identity: 'quotes', sourceVersion: 1, source: PLAIN_STREAM },
    ],
  })
  const analyze = (runtimes: string) => resolver.analyze(compileSimulationSource(`defineSimulation({ target: composition('page'), overrides: { runtimes: { ${runtimes} } } })`))
  const codes = (runtimes: string) => analyze(runtimes).diagnostics.map(item => item.code)

  it('mockRequest принимает GraphQL Query с выходами data(\'...\') и пути массивов data', () => {
    const result = analyze('orders: { request: mockRequest({ arrays: { orders: 3 } }) }')
    expect(result.diagnostics).toEqual([])
    expect(resolver.queryContract('orders').paths).toEqual(['orders'])
    expect(codes('orders: { request: mockRequest({ arrays: { missing: 3 } }) }')).toContain('simulation-array-path')
  })

  it('mockRequest принимает errors только для GraphQL Query и проверяет форму', () => {
    const result = analyze('orders: { request: mockRequest({ errors: [{ message: \'Denied\', path: [\'orders\'] }] }) }')
    expect(result.diagnostics).toEqual([])
    expect(result.artifact?.runtimes[0]?.request).toMatchObject({ errors: [{ message: 'Denied', path: ['orders'] }] })
    expect(compileSimulationSource('defineSimulation({ target: composition(\'page\'), overrides: { runtimes: { orders: { request: mockRequest({ errors: [] }) } } } })').diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'simulation-request-errors' }))
    const rest = new SimulationSourceResolver({
      compositions: [{ id: 'rest-page-id', identity: 'rest-page', sourceVersion: 1, source: 'defineComposition({ runtimes: { rows: query(\'rows\') } })' }],
      queries: [{ id: 'rows-id', identity: 'rows', sourceVersion: 2, source: `defineQuery({ request: { url: 'https://api.test/rows' }, outputs: { rows: output().from(response()).contract(field('Order').array()) } })` }],
      types: [{ id: 'order-id', identity: 'Order', sourceVersion: 1, source: ORDER_TYPE }, { id: 'id-id', identity: 'ID', sourceVersion: 1, source: '', isPrimitive: true }, { id: 'string-id', identity: 'String', sourceVersion: 1, source: '', isPrimitive: true }],
    })
    const restCodes = rest.analyze(compileSimulationSource('defineSimulation({ target: composition(\'rest-page\'), overrides: { runtimes: { rows: { request: mockRequest({ errors: [{ message: \'x\' }] }) } } } })')).diagnostics.map(item => item.code)
    expect(restCodes).toContain('simulation-request-errors-transport')
  })

  it('mockStream для graphqlSse: Type описывает data события next, event не указывается, errors разрешены', () => {
    const result = analyze('updates: { stream: mockStream({ type: OrderUpdatedData, errors: [{ message: \'Status is stale\', path: [\'orderUpdated\', \'status\'] }] }) }')
    expect(result.diagnostics).toEqual([])
    expect(result.artifact?.runtimes[0]?.stream).toMatchObject({ type: 'OrderUpdatedData', event: '', errors: [{ message: 'Status is stale', path: ['orderUpdated', 'status'] }] })
    expect(codes('updates: { stream: mockStream({ type: OrderUpdatedData, event: \'order.updated\' }) }')).toContain('simulation-stream-event-graphql')
  })

  it('mockStream для sse по-прежнему требует event и не принимает errors', () => {
    expect(analyze('quotes: { stream: mockStream({ type: Order, event: \'quote.updated\' }) }').diagnostics).toEqual([])
    expect(codes('quotes: { stream: mockStream({ type: Order }) }')).toContain('simulation-stream-contract')
    expect(codes('quotes: { stream: mockStream({ type: Order, event: \'quote.updated\', errors: [{ message: \'x\' }] }) }')).toContain('simulation-stream-errors-transport')
    expect(compileSimulationSource('defineSimulation({ target: composition(\'page\'), overrides: { runtimes: { quotes: { stream: mockStream({ type: Order, errors: [{ code: 1 }] }) } } } })').diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'simulation-stream-errors' }))
  })
})

describe('simulation runtime для GraphQL', () => {
  afterEach(async () => {
    await Endge.runtime.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Raph.reset()
    vi.restoreAllMocks()
  })

  it('mockRequest генерирует объект data по выходам data(\'...\') и не вызывает transport', async () => {
    const generate = vi.fn(async (schema: Record<string, any>) => ({
      orders: Array.from({ length: schema.properties.orders.minItems }, (_, index) => ({ id: `o-${index}`, status: 'new' })),
      meta: { total: 2 },
    }))
    setup({ request: { kind: 'mock-request', seed: 'fixed', arrays: { orders: 2 } } })
    const transport = vi.spyOn(Endge.runtime.query, 'executeArtifact')
    const session = await Endge.runtime.simulation.mount('scenario', { generator: { generate, openStream: vi.fn() } })
    const query = session.host.target!.getChild('orders') as QueryRuntimeHost
    await query.run()
    expect(generate.mock.calls[0][0]).toMatchObject({
      type: 'object',
      required: ['meta', 'orders'],
      properties: {
        orders: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' } } } },
        meta: { type: 'object', properties: { total: { type: 'number' } } },
      },
    })
    expect(query.getOutputs()).toMatchObject({ orders: [{ id: 'o-0' }, { id: 'o-1' }], total: 2, problems: [] })
    expect(transport).not.toHaveBeenCalled()
    await session.unmount()
  })

  it('mockRequest({ errors }) проходит errorPolicy GraphQL Query', async () => {
    const generate = vi.fn(async () => ({ orders: [{ id: 'o-0', status: 'new' }], meta: { total: 1 } }))
    const errors = [{ message: 'Total is unavailable', path: ['meta', 'total'] }]
    setup({ request: { kind: 'mock-request', arrays: { orders: 1 }, errors } })
    const warn = vi.spyOn(Endge.diagnostics, 'warn')
    const session = await Endge.runtime.simulation.mount('scenario', { generator: { generate, openStream: vi.fn() } })
    const query = session.host.target!.getChild('orders') as QueryRuntimeHost
    await query.run()
    expect(query.getOutputs()).toMatchObject({ orders: [{ id: 'o-0' }], total: 1, problems: [expect.objectContaining({ message: 'Total is unavailable', path: ['meta', 'total'] })] })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Total is unavailable'), expect.anything())
    await session.unmount()
  })

  it('mockRequest({ errors }) с errorPolicy throw даёт GraphQLQueryError', async () => {
    const generate = vi.fn(async () => ({ orders: [], meta: { total: 0 } }))
    setup({ request: { kind: 'mock-request', arrays: {}, errors: [{ message: 'Denied' }] }, errorPolicy: 'throw' })
    const session = await Endge.runtime.simulation.mount('scenario', { generator: { generate, openStream: vi.fn() } })
    const query = session.host.target!.getChild('orders') as QueryRuntimeHost
    const error = await query.run().catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(GraphQLQueryError)
    expect((error as GraphQLQueryError).errors).toEqual([expect.objectContaining({ message: 'Denied' })])
    expect(query.context.status).toBe('error')
    await session.unmount()
  })

  it('mockStream graphqlSse публикует события next через events.next и errorPolicy Stream', async () => {
    const warn = vi.spyOn(Endge.diagnostics, 'warn')
    let callbacks!: Parameters<StreamTransportFactory['open']>[1]
    let options!: SimulationMockStream
    const generator: SimulationGenerator = {
      generate: vi.fn(),
      openStream: (_schema, streamOptions, streamCallbacks) => {
        callbacks = streamCallbacks
        options = streamOptions
        return { close: async () => {} }
      },
    }
    const errors = [{ message: 'Status is stale', path: ['orderUpdated', 'status'] }]
    setup({ stream: { kind: 'mock-stream', type: 'OrderUpdatedData', event: '', intervalMs: 1000, itemsPerMessage: 1, fields: {}, errors } })
    const session = await Endge.runtime.simulation.mount('scenario', { generator })
    const stream = session.host.target!.getChild('updates') as StreamRuntimeHost
    const events = vi.fn()
    stream.on('event', events)
    expect(options).toMatchObject({ type: 'OrderUpdatedData', errors })
    callbacks.open()
    callbacks.message({ sourceEvent: 'message', id: '1:0', data: { orderUpdated: { id: 'o-1', status: 'shipped' } } })
    expect(events).toHaveBeenCalledTimes(1)
    expect(events.mock.calls[0][0]).toMatchObject({
      type: 'order.updated',
      payload: { id: 'o-1', status: 'shipped' },
      meta: { sourceEvent: 'next', graphQLErrors: errors },
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('GraphQL subscription'), expect.objectContaining({ eventName: 'endge.stream.graphql-errors' }))
    await session.unmount()
  })

  it('mockStream graphqlSse с errorPolicy throw даёт transport:error и не публикует событие', async () => {
    let callbacks!: Parameters<StreamTransportFactory['open']>[1]
    const generator: SimulationGenerator = {
      generate: vi.fn(),
      openStream: (_schema, _options, streamCallbacks) => {
        callbacks = streamCallbacks
        return { close: async () => {} }
      },
    }
    setup({
      stream: { kind: 'mock-stream', type: 'OrderUpdatedData', event: '', intervalMs: 1000, itemsPerMessage: 1, fields: {}, errors: [{ message: 'Denied' }] },
      streamSource: SSE_STREAM.replace('errorPolicy: \'all\'', 'errorPolicy: \'throw\''),
    })
    const session = await Endge.runtime.simulation.mount('scenario', { generator })
    const stream = session.host.target!.getChild('updates') as StreamRuntimeHost
    const events = vi.fn()
    const transportErrors = vi.fn()
    stream.on('event', events)
    stream.on('transport:error', transportErrors)
    callbacks.message({ sourceEvent: 'message', id: '1:0', data: { orderUpdated: { id: 'o-1', status: 'shipped' } } })
    expect(events).not.toHaveBeenCalled()
    expect(transportErrors.mock.calls[0][0]).toBeInstanceOf(GraphQLQueryError)
    expect(transportErrors.mock.calls[0][0]).toMatchObject({ errors: [{ message: 'Denied' }], data: { orderUpdated: { id: 'o-1' } } })
    expect(stream.context.status).toBe('error')
    await session.unmount()
  })

  it('отклоняет event в mockStream для graphqlSse до создания hosts', async () => {
    setup({ stream: { kind: 'mock-stream', type: 'OrderUpdatedData', event: 'order.updated', intervalMs: 1000, itemsPerMessage: 1, fields: {} } })
    await expect(Endge.runtime.simulation.mount('scenario', { generator: { generate: vi.fn(), openStream: vi.fn() } })).rejects.toThrow('graphqlSse')
    expect(Endge.runtime.getRuntimeHosts()).toEqual([])
  })
})

function setup(override: { request?: SimulationSourceArtifact['runtimes'][number]['request'], stream?: SimulationMockStream, streamSource?: string, errorPolicy?: string }): void {
  const query = Object.assign(new RQuery(), { id: 810, identity: 'orders', name: 'orders' })
  Endge.domain.addQuery(query)
  Endge.program.addArtifact(base('query', query.id, query.identity, compileQuery(ORDERS_QUERY({ errorPolicy: override.errorPolicy ?? 'all' }))))
  const types: Record<string, TypeProgramPayload> = {
    ID: { type: 'type', sourceVersion: 1, definition: null, runtimeType: 'ID' },
    String: { type: 'type', sourceVersion: 1, definition: null, runtimeType: 'String' },
    Number: { type: 'type', sourceVersion: 1, definition: null, runtimeType: 'Number' },
    Order: { type: 'type', sourceVersion: 1, definition: { kind: 'object', fields: [
      { key: 'id', type: { kind: 'reference', identity: 'ID' }, optional: false, array: false, examples: [] },
      { key: 'status', type: { kind: 'reference', identity: 'String' }, optional: false, array: false, examples: [] },
    ] } },
    OrderUpdatedData: { type: 'type', sourceVersion: 1, definition: { kind: 'object', fields: [
      { key: 'orderUpdated', type: { kind: 'reference', identity: 'Order' }, optional: false, array: false, examples: [] },
    ] } },
  }
  Object.entries(types).forEach(([identity, payload], index) => Endge.program.addArtifact(base('type', 820 + index, identity, payload)))
  const stream = Object.assign(new RStream(), { id: 830, identity: 'order-updates', name: 'order-updates' })
  Endge.domain.addStream(stream)
  const compiledStream = compileStreamSource(override.streamSource ?? SSE_STREAM)
  expect(compiledStream.diagnostics).toEqual([])
  Endge.program.addArtifact(base('stream', stream.id, stream.identity, compiledStream.artifact!))
  const composition = Object.assign(new RComposition(), { id: 840, identity: 'page', name: 'page' })
  Endge.domain.addComposition(composition)
  Endge.program.addArtifact(base('composition', composition.id, composition.identity, graph([
    runtime('orders', 'query', 'orders'),
    runtime('updates', 'stream', 'order-updates'),
  ])))
  const simulation = Object.assign(new RSimulation(), { id: 850, identity: 'scenario', name: 'scenario' })
  Endge.domain.addSimulation(simulation)
  Endge.program.addArtifact(base<SimulationSourceArtifact>('simulation', simulation.id, simulation.identity, {
    type: 'simulation',
    sourceVersion: 1,
    target: { entityType: 'composition', identity: 'page' },
    dataMode: 'mock',
    runtimes: [
      ...(override.request ? [{ alias: 'orders', request: override.request }] : []),
      ...(override.stream ? [{ alias: 'updates', stream: override.stream }] : []),
    ],
  }))
}

function runtime(name: string, kind: 'query' | 'stream', identity: string): CompositionProgramPayload['runtimes'][number] {
  return { name, path: name, scopePath: 'scope_default', kind, identity, activationOverride: { mode: 'startup' }, effectiveActivation: { mode: 'startup' }, props: {}, storeTo: [] }
}

function graph(runtimes: CompositionProgramPayload['runtimes']): CompositionProgramPayload {
  return {
    type: 'composition',
    sourceVersion: 1,
    activation: { mode: 'startup' },
    dataMode: 'mock',
    props: [],
    data: [],
    resources: [],
    runtimes,
    hooks: [],
    outputs: [],
    scopes: [{ name: 'scope_default', path: 'scope_default', parentPath: null, activationOverride: { mode: 'startup' }, effectiveActivation: { mode: 'startup' }, resources: [], runtimes: runtimes.map(item => item.path), children: [], sourceOrder: 0 }],
    graph: { inputs: [], dataInputs: [], updates: [], publications: [], mounts: [] },
  }
}

function base<T>(entityType: ProgramEntityType, id: string | number, identity: string, payload: T): ProgramArtifact<T> {
  return { ref: { entityType, id, identity }, sourceHash: `test:${identity}`, compilerVersion: 'test', contextHash: 'test', status: 'valid', diagnostics: [], dependencies: [], capabilities: ['compilable', 'executable'], metadata: { self: {}, nodes: [] }, payload }
}
