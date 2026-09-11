import type { StreamRuntimeHost } from '@/features/core/modules/runtime/hosts/StreamRuntimeHost'
import type { StreamSourceArtifact } from '@/features/core/modules/source/domain/types/stream-source.types'
import { Raph } from '@endge/raph'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { RStream } from '@/features/core/modules/domain/entities/RStream'
import { BrowserWebSocketStreamTransportFactory } from '@/features/core/modules/runtime/services/transports/BrowserWebSocketStreamTransportFactory'
import { compileStreamSource } from '@/features/core/modules/source/services/compilers/stream-source-compile'

/** Управляемый socket без сети: имитирует browser events, включая поздние callbacks. */
class TestWebSocket extends EventTarget {
  static instances: TestWebSocket[] = []
  send = vi.fn()
  close = vi.fn(() => this.remoteClose())

  constructor(public url: string) {
    super()
    TestWebSocket.instances.push(this)
  }

  open() { this.dispatchEvent(new Event('open')) }
  message(data: unknown) { this.dispatchEvent(Object.assign(new Event('message'), { data })) }
  remoteClose() { this.dispatchEvent(Object.assign(new Event('close'), { code: 1006 })) }
}

const subscription = { method: 'subscribe', params: { channel: 'ticker', symbol: ['BTC/USD'], snapshot: true } }

function compile(event = 'event({ match: { channel: \'ticker\' }, eachFrom: \'data\', type: \'quote.updated\' })'): StreamSourceArtifact {
  return compileStreamSource(`defineStream({
    transport: websocket({ url: env('QUOTES_WS_URL'), onOpen: [${JSON.stringify(subscription)}] }),
    events: { message: ${event} },
  })`).artifact!
}

/** Создаёт runtime через штатную strategy и публичный registry. */
function start(payload = compile()): StreamRuntimeHost {
  const model = Object.assign(new RStream(), { id: 9901, identity: 'websocket-quotes', name: 'Котировки' })
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
  return Endge.runtime.execute(model) as StreamRuntimeHost
}

describe('транспорт WebSocket и lifecycle Stream', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    TestWebSocket.instances = []
    vi.stubGlobal('WebSocket', TestWebSocket)
    vi.spyOn(Endge.workspace.variables, 'resolve').mockReturnValue('wss://example.test/quotes')
  })

  afterEach(async () => {
    await Endge.runtime.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Endge.context.setDataMode('live')
    Raph.app.reset()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  /** Реальное состояние host зависит только от подходящих сообщений, а не heartbeat. */
  it('разрешает env, отправляет подписку и разбирает массив ticker', () => {
    const host = start()
    const received = vi.fn()
    const errors = vi.fn()
    host.on('event', received)
    host.on('event:error', errors)
    const socket = TestWebSocket.instances[0]
    expect(socket.url).toBe('wss://example.test/quotes')
    socket.open()
    expect(socket.send.mock.calls).toEqual([[JSON.stringify(subscription)]])
    socket.message(JSON.stringify({ channel: 'heartbeat' }))
    socket.message(JSON.stringify({ success: true }))
    expect(received).not.toHaveBeenCalled()
    expect(errors).not.toHaveBeenCalled()
    socket.message(JSON.stringify({ channel: 'ticker', data: [{ symbol: 'BTC/USD', last: 100 }, { symbol: 'ETH/USD', last: 20 }] }))
    expect(received.mock.calls.map(([event]) => ({ type: event.type, payload: event.payload }))).toEqual([
      { type: 'quote.updated', payload: { symbol: 'BTC/USD', last: 100 } },
      { type: 'quote.updated', payload: { symbol: 'ETH/USD', last: 20 } },
    ])
    expect(host.context.receivedCount).toBe(2)
  })

  /** Потерянное соединение восстанавливает ту же подписку; старый socket не публикует данные. */
  it('переподключается с повторным onOpen и отменяет reconnect при остановке', async () => {
    const host = start()
    const received = vi.fn()
    host.on('event', received)
    const first = TestWebSocket.instances[0]
    first.open()
    first.remoteClose()
    expect(host.context.status).toBe('error')
    await vi.advanceTimersByTimeAsync(999)
    expect(TestWebSocket.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    const second = TestWebSocket.instances[1]
    second.open()
    expect(second.send.mock.calls).toEqual([[JSON.stringify(subscription)]])
    first.message(JSON.stringify({ channel: 'ticker', data: [{ last: 1 }] }))
    expect(received).not.toHaveBeenCalled()
    second.remoteClose()
    host.stop()
    await vi.advanceTimersByTimeAsync(30000)
    expect(TestWebSocket.instances).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  /** Пауза, mock и destroy не оставляют действующих соединений или таймеров. */
  it('закрывает socket на паузе и mock, возобновляет и освобождает при destroy', async () => {
    const host = start()
    const first = TestWebSocket.instances[0]
    await host.pause()
    first.open()
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(first.send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(30000)
    expect(TestWebSocket.instances).toHaveLength(1)
    await host.resume()
    expect(TestWebSocket.instances).toHaveLength(2)
    Endge.context.setDataMode('mock')
    expect(TestWebSocket.instances[1].close).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30000)
    expect(TestWebSocket.instances).toHaveLength(2)
    Endge.context.setDataMode('live')
    expect(TestWebSocket.instances).toHaveLength(3)
    await Endge.runtime.destroyRuntimeTreeAsync(host.id)
    expect(TestWebSocket.instances[2].close).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30000)
    expect(TestWebSocket.instances).toHaveLength(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  /** Ошибка одного сообщения диагностируется и не блокирует последующие корректные данные. */
  it('диагностирует неверный JSON, binary и eachFrom без массива', () => {
    const host = start()
    const transportErrors = vi.fn()
    const eventErrors = vi.fn()
    host.on('transport:error', transportErrors)
    host.on('event:error', eventErrors)
    const socket = TestWebSocket.instances[0]
    socket.message('{broken')
    socket.message(new ArrayBuffer(1))
    expect(transportErrors).toHaveBeenCalledTimes(2)
    socket.message(JSON.stringify({ channel: 'ticker', data: {} }))
    expect(eventErrors).toHaveBeenCalledTimes(1)
    socket.message(JSON.stringify({ channel: 'ticker', data: [] }))
    expect(host.context.receivedCount).toBe(0)
    socket.message(JSON.stringify({ channel: 'ticker', data: [{ last: 42 }] }))
    expect(host.context.status).toBe('success')
    expect(host.context.receivedCount).toBe(1)
  })

  /** Пути typeFrom/payloadFrom разрешаются внутри элемента, а match — на envelope. */
  it('читает dot-path фильтра и относительные пути каждого элемента', () => {
    const host = start(compile('event({ match: { \'meta.channel\': \'ticker\' }, eachFrom: \'data\', typeFrom: \'kind\', payloadFrom: \'quote\' })'))
    const received = vi.fn()
    host.on('event', received)
    TestWebSocket.instances[0].message(JSON.stringify({ meta: { channel: 'ticker' }, data: [{ kind: 'changed', quote: { last: 12 } }] }))
    expect(received).toHaveBeenCalledWith(expect.objectContaining({ type: 'changed', payload: { last: 12 } }))
  })

  /** Если consumer остановил host, оставшаяся часть сообщения не должна менять Store. */
  it('останавливает разбор массива при синхронной паузе из consumer', () => {
    const host = start()
    const received = vi.fn(() => {
      void host.pause()
    })
    host.on('event', received)
    TestWebSocket.instances[0].message(JSON.stringify({ channel: 'ticker', data: [{ last: 1 }, { last: 2 }] }))
    expect(received).toHaveBeenCalledTimes(1)
  })

  /** Ошибочная схема URL отклоняется до создания соединения. */
  it('отклоняет HTTP URL до открытия WebSocket', () => {
    const payload = compile()
    payload.transport.url = 'https://example.test/quotes'
    expect(() => new BrowserWebSocketStreamTransportFactory().open(payload, { open: vi.fn(), message: vi.fn(), error: vi.fn() })).toThrow('ws:// or wss://')
    expect(TestWebSocket.instances).toHaveLength(0)
  })
})
