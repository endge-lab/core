import type { StreamRuntimeHost } from '@/features/core/modules/runtime/hosts/StreamRuntimeHost'
import type { StreamSourceArtifact } from '@/features/core/modules/source/domain/types/stream-source.types'

import { Raph } from '@raphy-js/raph'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'
import { RComposition } from '@/features/core/modules/domain/entities/RComposition'
import { RStream } from '@/features/core/modules/domain/entities/RStream'
import { GraphQLQueryError, GraphQLResponseFormatError } from '@/features/core/modules/runtime/domain/graphql-query-error'
import { BrowserGraphQLSseStreamTransportFactory, GraphQLSseHttpError, readSseHttpStatus } from '@/features/core/modules/runtime/services/transports/BrowserGraphQLSseStreamTransportFactory'
import { compileCompositionSource } from '@/features/core/modules/source/services/compilers/composition-source-compile'
import { compileQuerySource } from '@/features/core/modules/source/services/compilers/query-source-compile'
import { compileStreamSource } from '@/features/core/modules/source/services/compilers/stream-source-compile'
import { createUpdateStoreRuntime } from '@/test/fixtures/update-source'

const SUBSCRIPTION = 'subscription OrderUpdated($id: ID!) { orderUpdated(id: $id) { id status } }'

function source(options: { method?: string, errorPolicy?: string, auth?: string, events?: string } = {}): string {
  return `defineStream({
    props: defineProps({
      orderId: field('ID'),
      tenant: field('String').default('ou'),
    }),
    transport: graphqlSse({
      url: env('GRAPHQL_SSE_URL'),
      method: '${options.method ?? 'POST'}',
      document: gql\`${SUBSCRIPTION}\`,
      variables: variables(({ prop }) => ({ id: prop('orderId') })),
      headers: { 'X-Tenant': prop('tenant'), 'X-Region': env('REGION') },
      auth: ${options.auth ?? '\'none\''},
      errorPolicy: '${options.errorPolicy ?? 'throw'}',
      reconnectDelay: 1000,
    }),
    events: ${options.events ?? `{
      next: event({ type: 'order.updated', payloadFrom: 'orderUpdated' }),
      complete: event('order.subscription-completed'),
    }`},
  })`
}

function compile(options?: Parameters<typeof source>[0]): StreamSourceArtifact {
  const result = compileStreamSource(source(options))
  expect(result.diagnostics).toEqual([])
  return result.artifact!
}

/**
 * Поддельный graphql-sse сервер: каждый fetch открывает управляемый поток text/event-stream.
 */
interface FakeConnection {
  url: string
  init: RequestInit
  push: (frame: string) => void
  end: () => void
}

const encoder = new TextEncoder()
const connections: FakeConnection[] = []
const fetchMock = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start(value) {
    controller = value
  } })
  init.signal?.addEventListener('abort', () => {
    try {
      controller.error(new DOMException('aborted', 'AbortError'))
    }
    catch {}
  })
  connections.push({
    url,
    init,
    push: frame => controller.enqueue(encoder.encode(frame)),
    end: () => controller.close(),
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
})

function next(result: unknown): string {
  return `event: next\ndata: ${JSON.stringify(result)}\n\n`
}

const flush = () => vi.advanceTimersByTimeAsync(0)

function start(payload: StreamSourceArtifact, props: Record<string, unknown> = { orderId: 'o-1' }): StreamRuntimeHost {
  const model = Object.assign(new RStream(), { id: 9911, identity: 'order-updates', name: 'Заказы' })
  Endge.domain.addStream(model)
  Endge.program.addArtifact({
    ref: { entityType: 'stream', id: model.id, identity: model.identity },
    sourceHash: 'test',
    compilerVersion: 'test',
    status: 'valid',
    diagnostics: [],
    dependencies: [],
    capabilities: ['compilable', 'executable'],
    metadata: { self: {}, nodes: [] },
    payload,
  })
  return Endge.runtime.execute(model, { meta: { props } } as any) as StreamRuntimeHost
}

describe('компиляция graphqlSse', () => {
  it('компилирует subscription, props, variables, headers и политику ошибок', () => {
    const artifact = compile({ method: 'GET', errorPolicy: 'all' })
    expect(artifact.props?.map(prop => prop.key)).toEqual(['orderId', 'tenant'])
    expect(artifact.transport).toMatchObject({
      kind: 'graphql-sse',
      url: '{GRAPHQL_SSE_URL}',
      method: 'GET',
      document: SUBSCRIPTION,
      operationName: 'OrderUpdated',
      variables: { type: 'object', properties: { id: { type: 'read', source: 'prop', path: 'orderId' } } },
      headers: { type: 'object' },
      authMode: 'none',
      errorPolicy: 'all',
      reconnectDelayMs: 1000,
      withCredentials: false,
    })
    expect(artifact.events.map(event => event.sourceEvent)).toEqual(['next', 'complete'])
  })

  it('по умолчанию использует POST, throw и задержку 3000 мс', () => {
    const result = compileStreamSource(`defineStream({
      transport: graphqlSse({ url: '/graphql/stream', document: gql\`subscription { tick }\` }),
      events: { next: event('tick') },
    })`)
    expect(result.diagnostics).toEqual([])
    expect(result.artifact?.props).toBeUndefined()
    expect(result.artifact?.transport).toMatchObject({ method: 'POST', errorPolicy: 'throw', reconnectDelayMs: 3000, authMode: 'inherit', variables: null, headers: null })
  })

  it.each([
    ['query вместо subscription', `graphqlSse({ url: '/s', document: gql\`query { tick }\` })`, '{ next: event(\'tick\') }', 'stream-graphql-operation-unsupported'],
    ['событие вне next/complete', `graphqlSse({ url: '/s', document: gql\`subscription { tick }\` })`, '{ next: event(\'tick\'), message: event(\'raw\') }', 'stream-graphql-sse-event'],
    ['нет события next', `graphqlSse({ url: '/s', document: gql\`subscription { tick }\` })`, '{ complete: event(\'done\') }', 'stream-graphql-sse-next-missing'],
    ['необъявленный prop', `graphqlSse({ url: '/s', document: gql\`subscription { tick }\`, variables: variables(({ prop }) => ({ id: prop('missing') })) })`, '{ next: event(\'tick\') }', 'stream-transport-prop-missing'],
    ['метод PUT', `graphqlSse({ url: '/s', method: 'PUT', document: gql\`subscription { tick }\` })`, '{ next: event(\'tick\') }', 'stream-graphql-sse-method'],
    ['неизвестная политика ошибок', `graphqlSse({ url: '/s', errorPolicy: 'none', document: gql\`subscription { tick }\` })`, '{ next: event(\'tick\') }', 'stream-graphql-error-policy'],
    ['неизвестное поле', `graphqlSse({ url: '/s', body: {}, document: gql\`subscription { tick }\` })`, '{ next: event(\'tick\') }', 'stream-graphql-sse-property'],
    // eslint-disable-next-line no-template-curly-in-string -- проверяется запрет interpolation в authored gql
    ['interpolation в document', 'graphqlSse({ url: \'/s\', document: gql`subscription { ${field} }` })', '{ next: event(\'tick\') }', 'stream-graphql-document-shape'],
    ['нет document', 'graphqlSse({ url: \'/s\' })', '{ next: event(\'tick\') }', 'stream-graphql-document-missing'],
    ['отрицательная задержка', `graphqlSse({ url: '/s', reconnectDelay: -1, document: gql\`subscription { tick }\` })`, '{ next: event(\'tick\') }', 'stream-graphql-sse-reconnect-delay'],
  ])('отклоняет %s', (_, transport, events, code) => {
    const result = compileStreamSource(`defineStream({ transport: ${transport}, events: ${events} })`)
    expect(result.artifact).toBeNull()
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'error', code })]))
  })

  it('компилирует extensions и url из props', () => {
    const result = compileStreamSource(`defineStream({
      props: defineProps({ endpoint: field('String'), trace: field('String') }),
      transport: graphqlSse({
        url: prop('endpoint'),
        document: gql\`subscription { tick }\`,
        extensions: { persistedQuery: { version: 1 }, trace: prop('trace'), region: env('REGION') },
      }),
      events: { next: event('tick') },
    })`)
    expect(result.diagnostics).toEqual([])
    expect(result.artifact?.transport).toMatchObject({ kind: 'graphql-sse', url: '', urlExpression: expect.any(Object), extensions: expect.any(Object) })

    const plain = compile()
    expect(plain.transport).not.toHaveProperty('extensions')
    expect(plain.transport).not.toHaveProperty('urlExpression')
  })

  it.each([
    ['extensions не object literal', `graphqlSse({ url: '/s', document: gql\`subscription { tick }\`, extensions: 'x' })`, 'stream-graphql-sse-extensions'],
    ['extensions с необъявленным prop', `graphqlSse({ url: '/s', document: gql\`subscription { tick }\`, extensions: { a: prop('missing') } })`, 'stream-transport-prop-missing'],
    ['url с необъявленным prop', `graphqlSse({ url: prop('missing'), document: gql\`subscription { tick }\` })`, 'stream-transport-prop-missing'],
  ])('%s', (_name, transport, code) => {
    const result = compileStreamSource(`defineStream({ transport: ${transport}, events: { next: event('tick') } })`)
    expect(result.diagnostics.map(item => item.code)).toContain(code)
    expect(result.artifact).toBeNull()
  })

  it('разрешает props только для graphqlSse', () => {
    const result = compileStreamSource(`defineStream({
      props: defineProps({ id: field('ID') }),
      transport: sse({ url: '/events' }),
      events: { message: event('changed') },
    })`)
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'stream-props-transport' })])
  })

  it('query по-прежнему отклоняет subscription и подсказывает graphqlSse', () => {
    const result = compileQuerySource(`defineQuery({
      kind: 'graphql',
      request: { endpoint: '/graphql', document: gql\`subscription { tick }\` },
    })`)
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({
      code: 'query-source-graphql-subscription-unsupported',
      message: expect.stringContaining('graphqlSse'),
    })]))
  })
})

describe('runtime graphqlSse', () => {
  beforeEach(() => {
    // Endge настраивается до подмены document: fetch-event-source нужен только EventTarget.
    void Endge.runtime
    vi.useFakeTimers()
    connections.length = 0
    fetchMock.mockClear()
    vi.stubGlobal('document', new EventTarget())
    vi.stubGlobal('window', { fetch: fetchMock, setTimeout, clearTimeout })
    const variables: Record<string, string> = {
      '{GRAPHQL_SSE_URL}': 'https://api.test/graphql/stream?tenant=ou',
      '{REGION}': 'eu',
    }
    vi.spyOn(Endge.workspace.variables, 'resolve').mockImplementation(((token: unknown) => variables[String(token)] ?? token) as any)
  })

  afterEach(async () => {
    await Endge.runtime.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Endge.context.setDataMode('live')
    Raph.reset()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('pOST: отправляет JSON-тело с variables из props, публикует data событий next и закрывается по complete', async () => {
    const host = start(compile())
    const events = vi.fn()
    host.on('event', events)
    await flush()

    expect(connections).toHaveLength(1)
    const [connection] = connections
    expect(connection.url).toBe('https://api.test/graphql/stream?tenant=ou')
    expect(connection.init.method).toBe('POST')
    expect(JSON.parse(String(connection.init.body))).toEqual({
      query: SUBSCRIPTION,
      operationName: 'OrderUpdated',
      variables: { id: 'o-1' },
    })
    expect(connection.init.headers).toMatchObject({
      'Content-Type': 'application/json; charset=utf-8',
      'X-Tenant': 'ou',
      'X-Region': 'eu',
      'accept': 'text/event-stream',
    })
    expect(connection.init.headers).not.toHaveProperty('Authorization')

    connection.push(next({ data: { orderUpdated: { id: 'o-1', status: 'shipped' } } }))
    connection.push(next({ data: { orderUpdated: { id: 'o-1', status: 'delivered' } } }))
    await flush()
    expect(events.mock.calls.map(([envelope]) => [envelope.type, envelope.payload])).toEqual([
      ['order.updated', { id: 'o-1', status: 'shipped' }],
      ['order.updated', { id: 'o-1', status: 'delivered' }],
    ])
    expect(events.mock.calls[0][0].meta).toMatchObject({ source: 'order-updates', sourceEvent: 'next' })
    expect(host.context).toMatchObject({ status: 'success', receivedCount: 2 })

    connection.push('event: complete\ndata:\n\n')
    await flush()
    expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'order.subscription-completed', payload: null }))
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('gET: передаёт query, operationName и variables в query string без тела', async () => {
    start(compile({ method: 'GET' }))
    await flush()

    const url = new URL(connections[0].url)
    expect(connections[0].init.method).toBe('GET')
    expect(connections[0].init.body).toBeUndefined()
    expect(connections[0].init.headers).not.toHaveProperty('Content-Type')
    expect(url.origin + url.pathname).toBe('https://api.test/graphql/stream')
    expect(url.searchParams.get('tenant')).toBe('ou')
    expect(url.searchParams.get('query')).toBe(SUBSCRIPTION)
    expect(url.searchParams.get('operationName')).toBe('OrderUpdated')
    expect(JSON.parse(url.searchParams.get('variables')!)).toEqual({ id: 'o-1' })
  })

  it('отправляет extensions в теле POST и параметром GET', async () => {
    const artifact = compileStreamSource(source().replace('reconnectDelay: 1000,', 'reconnectDelay: 1000, extensions: { trace: prop(\'tenant\'), persistedQuery: { version: 1 } },')).artifact!
    start(artifact)
    await flush()
    expect(JSON.parse(String(connections[0].init.body)).extensions).toEqual({ trace: 'ou', persistedQuery: { version: 1 } })

    const getArtifact = compileStreamSource(source({ method: 'GET' }).replace('reconnectDelay: 1000,', 'reconnectDelay: 1000, extensions: { trace: \'t-1\' },')).artifact!
    await Endge.runtime.reset()
    start(getArtifact)
    await flush()
    expect(JSON.parse(new URL(connections[1].url).searchParams.get('extensions')!)).toEqual({ trace: 't-1' })
  })

  it('берёт url из props и переподключается к новому адресу при смене prop', async () => {
    const artifact = compileStreamSource(source()
      .replace('url: env(\'GRAPHQL_SSE_URL\'),', 'url: prop(\'endpoint\'),')
      .replace('tenant: field(\'String\').default(\'ou\'),', 'tenant: field(\'String\').default(\'ou\'),\n      endpoint: field(\'String\').default(\'{GRAPHQL_SSE_URL}\'),')).artifact!
    expect(artifact.transport).toMatchObject({ url: '' })
    const host = start(artifact)
    await flush()
    // Значение prop проходит через переменные workspace, как строковый url.
    expect(connections[0].url).toBe('https://api.test/graphql/stream?tenant=ou')

    host.setProps({ endpoint: 'https://kzn.test/stream' })
    await flush()
    expect(connections).toHaveLength(2)
    expect(connections[1].url).toBe('https://kzn.test/stream')
    expect(connections[0].init.signal?.aborted).toBe(true)
  })

  it('останавливается без переподключения на HTTP 4xx и переподключается на 5xx', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('busy', { status: 503 }))
    const host = start(compile())
    const transportErrors = vi.fn()
    host.on('transport:error', transportErrors)
    await flush()
    expect(transportErrors.mock.calls[0][0]).toMatchObject({ message: 'Unexpected response: 503' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await Endge.runtime.reset()
    fetchMock.mockClear()
    fetchMock.mockImplementationOnce(async () => new Response('bad document', { status: 400 }))
    const stopped = start(compile())
    const stoppedErrors = vi.fn()
    stopped.on('transport:error', stoppedErrors)
    await flush()
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(stoppedErrors).toHaveBeenCalledTimes(1)
    expect(stoppedErrors.mock.calls[0][0]).toBeInstanceOf(GraphQLSseHttpError)
    expect(stoppedErrors.mock.calls[0][0]).toMatchObject({ status: 400 })
    expect(stopped.context.status).toBe('error')
  })

  it.each([408, 429])('переподключается на временном HTTP %i, как на 5xx', async (status) => {
    fetchMock.mockImplementationOnce(async () => new Response('later', { status }))
    const host = start(compile())
    const transportErrors = vi.fn()
    host.on('transport:error', transportErrors)
    await flush()
    expect(transportErrors).toHaveBeenCalledTimes(1)
    expect(transportErrors.mock.calls[0][0]).not.toBeInstanceOf(GraphQLSseHttpError)
    expect(transportErrors.mock.calls[0][0]).toMatchObject({ message: `Unexpected response: ${status}` })
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await flush()
    expect(host.context.status).not.toBe('error')
  })

  it('переподключается после обрыва без complete с заданной задержкой', async () => {
    const host = start(compile())
    const transportErrors = vi.fn()
    host.on('transport:error', transportErrors)
    await flush()
    connections[0].end()
    await flush()
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(connections[1].init.body)).variables).toEqual({ id: 'o-1' })

    host.stop()
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(connections.every(connection => connection.init.signal?.aborted)).toBe(true)
  })

  it('переоткрывает подписку при изменении variables из props и не трогает её при тех же значениях', async () => {
    const host = start(compile())
    await flush()
    host.setProps({ orderId: 'o-1' })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    host.setProps({ orderId: 'o-2' })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(connections[0].init.signal?.aborted).toBe(true)
    expect(JSON.parse(String(connections[1].init.body)).variables).toEqual({ id: 'o-2' })
  })

  it('errorPolicy throw: next с errors даёт transport:error GraphQLQueryError и не публикует событие', async () => {
    const host = start(compile())
    const events = vi.fn()
    const transportErrors = vi.fn()
    host.on('event', events)
    host.on('transport:error', transportErrors)
    await flush()

    const errors = [{ message: 'Order is hidden', path: ['orderUpdated'], extensions: { code: 'FORBIDDEN' } }]
    connections[0].push(next({ data: { orderUpdated: null }, errors }))
    await flush()
    expect(events).not.toHaveBeenCalled()
    expect(transportErrors).toHaveBeenCalledTimes(1)
    const error = transportErrors.mock.calls[0][0]
    expect(error).toBeInstanceOf(GraphQLQueryError)
    expect(error.errors).toEqual(errors)
    expect(error.data).toEqual({ orderUpdated: null })
    expect(error.operationName).toBe('OrderUpdated')
    expect(host.context.status).toBe('error')

    connections[0].push(next({ data: { orderUpdated: { id: 'o-1' } } }))
    await flush()
    expect(events).toHaveBeenCalledTimes(1)
    expect(host.context.status).toBe('success')
  })

  it('errorPolicy all: публикует частичные data с meta.graphQLErrors и пишет warning', async () => {
    const warn = vi.spyOn(Endge.diagnostics, 'warn')
    const host = start(compile({ errorPolicy: 'all' }))
    const events = vi.fn()
    host.on('event', events)
    await flush()

    const errors = [{ message: 'Status is stale', path: ['orderUpdated', 'status'] }]
    connections[0].push(next({ data: { orderUpdated: { id: 'o-1', status: null } }, errors }))
    connections[0].push(next({ data: null, errors }))
    await flush()
    expect(events).toHaveBeenCalledTimes(1)
    expect(events.mock.calls[0][0]).toMatchObject({
      payload: { id: 'o-1', status: null },
      meta: { graphQLErrors: errors },
    })
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0][1]).toMatchObject({ eventName: 'endge.stream.graphql-errors' })
  })

  it('errorPolicy ignore: публикует data без errors и без warning', async () => {
    const warn = vi.spyOn(Endge.diagnostics, 'warn')
    const host = start(compile({ errorPolicy: 'ignore' }))
    const events = vi.fn()
    host.on('event', events)
    await flush()

    connections[0].push(next({ data: { orderUpdated: { id: 'o-1' } }, errors: [{ message: 'partial' }] }))
    await flush()
    expect(events).toHaveBeenCalledTimes(1)
    expect(events.mock.calls[0][0].meta).not.toHaveProperty('graphQLErrors')
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('GraphQL subscription'), expect.anything())
  })

  it('composition передаёт withProps в Stream и переоткрывает подписку при изменении связанных data', async () => {
    const store = createUpdateStoreRuntime({
      storeSource: `defineStore({ data: { selectedOrder: value('o-1') } })`,
      updates: [{ identity: 'order-changed', handles: ['order.updated'], source: `defineUpdate({ mutations: [{ strategy: 'set', target: 'selectedOrder', value: input('id') }] })` }],
    })
    const model = Object.assign(new RStream(), { id: 9911, identity: 'order-updates', name: 'Заказы' })
    Endge.domain.addStream(model)
    Endge.program.addArtifact({
      ref: { entityType: 'stream', id: model.id, identity: model.identity },
      sourceHash: 'test',
      compilerVersion: 'test',
      status: 'valid',
      diagnostics: [],
      dependencies: [],
      capabilities: ['compilable', 'executable'],
      metadata: { self: {}, nodes: [] },
      payload: compile(),
    })
    const compositionSource = `defineComposition({
      data: { db: store('test-update-store') },
      runtimes: { feed: stream('order-updates').withProps({ orderId: fromData('db.selectedOrder'), tenant: 'ops' }) },
    })`
    const composition = RComposition.fromPlain({ id: 9912, identity: 'ou-page', name: 'ОУ', source: compositionSource })
    Endge.domain.addComposition(composition)
    const compiled = compileCompositionSource(compositionSource)
    expect(compiled.diagnostics).toEqual([])
    Endge.program.addArtifact({
      ref: { entityType: 'composition', id: composition.id, identity: composition.identity },
      sourceHash: 'test',
      compilerVersion: 'test',
      status: 'valid',
      diagnostics: [],
      dependencies: [],
      capabilities: ['compilable', 'executable'],
      metadata: { self: {}, nodes: [] },
      payload: compiled.artifact!,
    })

    await Endge.runtime.composition.mount('ou-page', { dataRuntimes: { db: store.id } })
    await flush()
    expect(connections).toHaveLength(1)
    expect(JSON.parse(String(connections[0].init.body)).variables).toEqual({ id: 'o-1' })
    expect(connections[0].init.headers).toMatchObject({ 'X-Tenant': 'ops' })

    Raph.set(store.getDataPath('selectedOrder'), 'o-9')
    await flush()
    expect(connections).toHaveLength(2)
    expect(connections[0].init.signal?.aborted).toBe(true)
    expect(JSON.parse(String(connections[1].init.body)).variables).toEqual({ id: 'o-9' })
  })

  it('некорректный ExecutionResult даёт GraphQLResponseFormatError', async () => {
    const host = start(compile())
    const transportErrors = vi.fn()
    host.on('transport:error', transportErrors)
    await flush()
    connections[0].push('event: next\ndata: [1,2]\n\n')
    await flush()
    expect(transportErrors.mock.calls[0][0]).toBeInstanceOf(GraphQLResponseFormatError)
  })
})

describe('авторизация graphqlSse', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    connections.length = 0
    fetchMock.mockClear()
    vi.stubGlobal('document', new EventTarget())
    vi.stubGlobal('window', { fetch: fetchMock, setTimeout, clearTimeout })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('добавляет Bearer token профиля и обновляет сессию после 401', async () => {
    const artifact = compile({ auth: '{ mode: \'profile\', profile: \'keycloak-ou\' }' })
    const resolve = vi.fn()
      .mockResolvedValueOnce({ profileIdentity: 'keycloak-ou', accessToken: 'first', headers: {}, expiresAt: null })
      .mockResolvedValueOnce({ profileIdentity: 'keycloak-ou', accessToken: 'second', headers: {}, expiresAt: null })
    fetchMock.mockImplementationOnce(async () => new Response('denied', { status: 401 }))
    const callbacks = { message: vi.fn(), error: vi.fn(), open: vi.fn() }
    const connection = new BrowserGraphQLSseStreamTransportFactory(resolve).open(
      { ...artifact, transport: { ...artifact.transport, url: 'https://api.test/graphql/stream' } },
      callbacks,
      { variables: { id: 'o-1' }, headers: { 'X-Tenant': 'ou' } },
    )
    await flush()
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ 'Authorization': 'Bearer first', 'X-Tenant': 'ou' })
    expect(callbacks.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'Unexpected response: 401' }))
    expect(resolve).toHaveBeenLastCalledWith({ mode: 'profile', profile: 'keycloak-ou' }, { forceRefresh: false })

    await vi.advanceTimersByTimeAsync(1000)
    expect(resolve).toHaveBeenLastCalledWith({ mode: 'profile', profile: 'keycloak-ou' }, { forceRefresh: true })
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({ Authorization: 'Bearer second' })
    expect(callbacks.open).toHaveBeenCalledTimes(1)
    await connection.close()
  })

  it('после повторного 401 с обновлённым токеном останавливает подписку', async () => {
    const artifact = compile({ auth: '{ mode: \'profile\', profile: \'keycloak-ou\' }' })
    const resolve = vi.fn().mockResolvedValue({ profileIdentity: 'keycloak-ou', accessToken: 'token', headers: {}, expiresAt: null })
    fetchMock.mockImplementation(async () => new Response('denied', { status: 401 }))
    const callbacks = { message: vi.fn(), error: vi.fn(), open: vi.fn() }
    const connection = new BrowserGraphQLSseStreamTransportFactory(resolve).open(
      { ...artifact, transport: { ...artifact.transport, url: 'https://api.test/graphql/stream' } },
      callbacks,
      { variables: { id: 'o-1' } },
    )
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(resolve).toHaveBeenLastCalledWith({ mode: 'profile', profile: 'keycloak-ou' }, { forceRefresh: true })
    expect(callbacks.error).toHaveBeenCalledTimes(2)
    expect(callbacks.error.mock.calls[1][0]).toBeInstanceOf(GraphQLSseHttpError)
    expect(callbacks.error.mock.calls[1][0]).toMatchObject({ status: 401 })
    fetchMock.mockReset()
    await connection.close()
  })

  it('без auth останавливается на первом 401 и читает статус из ошибки', async () => {
    const artifact = compile()
    fetchMock.mockImplementationOnce(async () => new Response('denied', { status: 401 }))
    const callbacks = { message: vi.fn(), error: vi.fn(), open: vi.fn() }
    new BrowserGraphQLSseStreamTransportFactory(vi.fn()).open(
      { ...artifact, transport: { ...artifact.transport, url: 'https://api.test/graphql/stream' } },
      callbacks,
    )
    await flush()
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(callbacks.error.mock.calls[0][0]).toMatchObject({ status: 401 })
    expect(readSseHttpStatus(new Error('Unexpected response: 404'))).toBe(404)
    expect(readSseHttpStatus({ status: 502 })).toBe(502)
    expect(readSseHttpStatus(new Error('network'))).toBeNull()
  })

  it('экспортирует GraphQLSseHttpError из root @endge/core', async () => {
    const root = await import('@/main')
    expect(root.GraphQLSseHttpError).toBe(GraphQLSseHttpError)
    const error = new root.GraphQLSseHttpError(403, 'https://api.test/stream')
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ name: 'GraphQLSseHttpError', status: 403, url: 'https://api.test/stream' })
  })
})
