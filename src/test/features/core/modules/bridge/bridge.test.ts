import type { EndgeBootContext } from '@/features/core/kernel/types/bootstrap.types'
import type { BridgeMessage, EndgeBridgeBootOptions } from '@/features/core/modules/bridge/domain/bridge.type'
import type { DiagnosticsSnapshot } from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { BrowserBridge_Adapter } from '@/features/core/modules/bridge/adapters/BrowserBridge_Adapter'
import { parseBridgeAllowedServers } from '@/features/core/modules/bridge/config/bridge.config'
import { EndgeBridge_Module } from '@/features/core/modules/bridge/EndgeBridge_Module'
import { RSimulation } from '@/features/core/modules/domain/entities/RSimulation'

class FakeSocket {
  public readyState = 1
  public bufferedAmount = 0
  public onopen: (() => void) | null = null
  public onclose: ((event: { code: number }) => void) | null = null
  public onerror: (() => void) | null = null
  public onmessage: ((event: { data: string }) => void) | null = null
  public sent: BridgeMessage[] = []
  public send(value: string): void { this.sent.push(JSON.parse(value)) }
  public close(): void { this.readyState = 3 }
  public receive(message: BridgeMessage): void { this.onmessage?.({ data: JSON.stringify(message) }) }
  public welcome(): void {
    this.onopen?.()
    this.receive({ type: 'welcome', data: { protocol: 1, instanceId: 'connection' } })
  }
}

class FakeAdapter extends BrowserBridge_Adapter {
  public sockets: FakeSocket[] = []
  public unsubscribe = vi.fn()
  public override open(): WebSocket {
    const socket = new FakeSocket()
    this.sockets.push(socket)
    return socket as unknown as WebSocket
  }

  public override subscribePage(): () => void { return this.unsubscribe }
}

const server = 'https://config.example.com'
const secondServer = 'https://other.example.com'
const modules: EndgeBridge_Module[] = []

function fixture(options?: EndgeBridgeBootOptions) {
  const adapter = new FakeAdapter()
  const simulation = Object.assign(new RSimulation(), { source: 'simulation source', sourceVersion: 1 })
  const snapshot = vi.spyOn(Endge.diagnostics, 'snapshot').mockImplementation(() => ({ generatedAt: 1, trigger: 'manual' } satisfies DiagnosticsSnapshot))
  vi.spyOn(Endge.domain, 'getSimulationByIdentity').mockImplementation(identity => identity === 'sim' ? simulation : null)
  const module = new EndgeBridge_Module(adapter)
  modules.push(module)
  module.setup({ scope: { workspaceIdentity: 'workspace' }, bridge: options } as EndgeBootContext)
  module.start()
  return { module, adapter, simulation, snapshot }
}

async function tick() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

async function approve(module: EndgeBridge_Module, adapter: FakeAdapter, sessionId = 'session') {
  const socket = adapter.sockets[0]
  socket.welcome()
  socket.receive({ type: 'sessionRequested', data: { sessionId, displayName: 'Developer', workspaceIdentity: 'workspace', expiresAt: Date.now() + 45_000 } })
  module.debug.respondToConsent(module.debug.pendingConsent!, true)
  await tick()
  socket.receive({ type: 'sessionStarted', data: { sessionId, clientId: 'connection', configuratorId: 'config' } })
  return socket
}

afterEach(() => {
  for (const module of modules.splice(0)) {
    module.reset()
  }
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('политика и lifecycle bridge', () => {
  it('отзывает зависшее соединение по heartbeat timeout и освобождает watchdog при reset', () => {
    vi.useFakeTimers()
    const { module, adapter } = fixture({ role: 'client', allowedServers: [server], debug: true })
    adapter.sockets[0].welcome()
    vi.advanceTimersByTime(75_000)
    expect(adapter.sockets[0].readyState).toBe(3)
    expect(module.connections[0]).toMatchObject({ status: 'reconnecting', error: 'Server heartbeat timed out' })
    module.reset()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('нормализует CSV, запрещает credentials и остаётся выключенным без boot policy', () => {
    expect(parseBridgeAllowedServers(` ${server}/, ,${server},${secondServer}`)).toEqual([server, secondServer])
    expect(() => parseBridgeAllowedServers('https://user:secret@example.com')).toThrow()
    const { adapter } = fixture()
    expect(adapter.sockets).toHaveLength(0)
  })

  it('владеет одним соединением и отменяет reconnect при reset', () => {
    vi.useFakeTimers()
    const { module, adapter } = fixture({ role: 'client', allowedServers: [server], debug: true })
    module.connect(`${server}/`)
    expect(adapter.sockets).toHaveLength(1)
    expect(() => module.connect(secondServer)).toThrow()
    adapter.sockets[0].onclose?.({ code: 1006 })
    module.reset()
    vi.runAllTimers()
    expect(adapter.sockets).toHaveLength(1)
    expect(adapter.unsubscribe).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('резервирует одно согласие для всех серверов и отзывает его при disconnect', async () => {
    const { module, adapter } = fixture({ role: 'client', allowedServers: [server, secondServer], debug: true })
    for (const socket of adapter.sockets) {
      socket.welcome()
    }
    const request = { type: 'sessionRequested', data: { sessionId: 'one', displayName: 'Developer', workspaceIdentity: 'workspace', expiresAt: Date.now() + 45_000 } }
    adapter.sockets[0].receive(request)
    adapter.sockets[1].receive({ ...request, data: { ...request.data, sessionId: 'two' } })
    const pending = module.debug.pendingConsent!
    expect(pending).toMatchObject({ serverUrl: server, sessionId: 'one' })
    expect(adapter.sockets[1].sent.at(-1)).toMatchObject({ type: 'acceptSession', accepted: false })
    module.disconnect(server)
    expect(module.debug.pendingConsent).toBeNull()
    expect(module.debug.respondToConsent(pending, true)).toBe(false)
    await tick()
    expect(adapter.sockets[0].sent.some(m => m.type === 'acceptSession')).toBe(false)
    expect(module.debug.sessions).toEqual([])
  })

  it('ожидает явного ответа UI и acknowledgement до выполнения команд', () => {
    const { module, adapter, snapshot } = fixture({ role: 'client', allowedServers: [server], debug: true })
    const socket = adapter.sockets[0]
    socket.welcome()
    socket.receive({ type: 'sessionRequested', data: { sessionId: 'one', displayName: 'Developer', workspaceIdentity: 'workspace', expiresAt: Date.now() + 45_000 } })
    const pending = module.debug.pendingConsent!
    expect(Object.isFrozen(pending)).toBe(true)
    expect(socket.sent.some(message => message.type === 'acceptSession')).toBe(false)
    const started = { type: 'sessionStarted', data: { sessionId: 'one', clientId: 'connection', configuratorId: 'config' } }
    socket.receive(started)
    socket.receive({ type: 'getSnapshot', id: 'premature', sessionId: 'one' })
    expect(snapshot).not.toHaveBeenCalled()
    expect(module.debug.respondToConsent({ ...pending, serverUrl: secondServer }, true)).toBe(false)
    expect(module.debug.respondToConsent(pending, true)).toBe(true)
    expect(module.debug.pendingConsent).toBeNull()
    expect(socket.sent.at(-1)).toMatchObject({ type: 'acceptSession', accepted: true })
    socket.receive({ type: 'getSnapshot', id: 'before-ack', sessionId: 'one' })
    expect(snapshot).not.toHaveBeenCalled()
    socket.receive(started)
    socket.receive({ type: 'getSnapshot', id: 'after-ack', sessionId: 'one' })
    expect(snapshot).toHaveBeenCalledOnce()
    expect(module.debug.respondToConsent(pending, true)).toBe(false)
  })

  it('снимает отказанный и отозванный запрос без сохранения согласия', () => {
    const { module, adapter } = fixture({ role: 'client', allowedServers: [server], debug: true })
    const socket = adapter.sockets[0]
    socket.welcome()
    const data = { sessionId: 'one', displayName: 'Developer', workspaceIdentity: 'workspace', expiresAt: Date.now() + 45_000 }
    socket.receive({ type: 'sessionRequested', data })
    const first = module.debug.pendingConsent!
    module.debug.respondToConsent(first, false)
    expect(socket.sent.at(-1)).toMatchObject({ type: 'acceptSession', accepted: false })
    socket.receive({ type: 'sessionRequested', data: { ...data, sessionId: 'two' } })
    expect(module.debug.respondToConsent(first, true)).toBe(false)
    expect(module.debug.pendingConsent?.sessionId).toBe('two')
    socket.receive({ type: 'sessionEnded', sessionId: 'two' })
    expect(module.debug.pendingConsent).toBeNull()
    socket.receive({ type: 'sessionRequested', data: { ...data, sessionId: 'three' } })
    const third = module.debug.pendingConsent!
    module.reset()
    expect(module.debug.pendingConsent).toBeNull()
    expect(module.debug.respondToConsent(third, true)).toBe(false)
  })

  it('закрывает запрос по deadline и отвергает поздний клик даже при задержанном timer', () => {
    vi.useFakeTimers()
    const { module, adapter } = fixture({ role: 'client', allowedServers: [server], debug: true })
    const socket = adapter.sockets[0]
    socket.welcome()
    const request = (sessionId: string) => socket.receive({ type: 'sessionRequested', data: {
      sessionId,
      displayName: 'Developer',
      workspaceIdentity: 'workspace',
      expiresAt: Date.now() + 1000,
    } })
    request('one')
    const first = module.debug.pendingConsent!
    vi.advanceTimersByTime(1000)
    expect(module.debug.pendingConsent).toBeNull()
    expect(socket.sent.at(-1)).toMatchObject({ type: 'acceptSession', accepted: false })
    expect(module.debug.respondToConsent(first, true)).toBe(false)
    request('two')
    const second = module.debug.pendingConsent!
    vi.setSystemTime(Date.now() + 2000)
    module.debug.respondToConsent(second, true)
    expect(socket.sent.at(-1)).toMatchObject({ type: 'acceptSession', sessionId: 'two', accepted: false })
    expect(module.debug.pendingConsent).toBeNull()
    module.reset()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('проверяет source до mock и делегирует сбор snapshot диагностике', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { module, adapter, snapshot } = fixture({ role: 'client', allowedServers: [server], debug: true })
    const socket = await approve(module, adapter)
    socket.receive({ type: 'runSimulation', id: 'missing', sessionId: 'session', identity: 'missing', expectedHash: 'x' })
    await tick()
    expect(socket.sent.at(-1)?.data).toEqual({ status: 'rejected', reason: 'not-found' })
    socket.receive({ type: 'runSimulation', id: 'mismatch', sessionId: 'session', identity: 'sim', expectedHash: 'x' })
    await tick()
    expect(socket.sent.at(-1)?.data).toEqual({ status: 'rejected', reason: 'hash-mismatch' })
    expect(log).not.toHaveBeenCalled()
    const hash = await module.debug.getSimulationHash('sim')
    socket.receive({ type: 'runSimulation', id: 'match', sessionId: 'session', identity: 'sim', expectedHash: hash })
    await tick()
    expect(socket.sent.at(-1)?.data).toEqual({ status: 'mocked', identity: 'sim', hash })
    expect(log).toHaveBeenCalledOnce()
    socket.receive({ type: 'getSnapshot', id: 'snapshot', sessionId: 'session' })
    expect(snapshot).toHaveBeenCalledOnce()
    expect(snapshot).toHaveBeenCalledWith({
      includeTelemetry: true,
      includeProblems: true,
      includeConfiguration: true,
      includeEffectiveConfiguration: true,
      includeDomain: true,
      includeProgram: true,
      includeRuntime: true,
      includeRaphData: true,
      includeRaphGraph: true,
    })
    expect(socket.sent.at(-1)?.data).toEqual({ generatedAt: 1, trigger: 'manual' })
    module.disconnect(server)
    expect(module.debug.sessions).toEqual([])
  })

  it('завершает pending requests ошибкой при закрытии транспорта', async () => {
    const { module, adapter } = fixture({ role: 'configurator', serverUrl: server, debug: true })
    const socket = adapter.sockets[0]
    socket.welcome()
    const request = module.debug.requestSession({ serverUrl: server, instanceId: 'client' })
    const rejection = expect(request).rejects.toThrow('Connection closed')
    module.disconnect(server)
    await rejection
    expect(module.debug.sessions).toEqual([])
  })

  it('считает уникальных пользователей и сохраняет отдельные подключения', () => {
    const { module, adapter } = fixture({ role: 'configurator', serverUrl: server })
    adapter.sockets[0].welcome()
    adapter.sockets[0].receive({ type: 'configurators', data: [
      { instanceId: 'one', userId: 'user', displayName: 'Developer', label: 'Tab 1' },
      { instanceId: 'two', userId: 'user', displayName: 'Developer', label: 'Tab 2' },
    ] })
    expect(module.configurator.connections).toHaveLength(2)
    expect(module.configurator.participants).toMatchObject([{ connectionCount: 2 }])
    module.disconnect(server)
    expect(module.configurator.participants).toEqual([])
  })

  it('не восстанавливает сессию из ответа, обработанного после reset', async () => {
    const { module, adapter } = fixture({ role: 'configurator', serverUrl: server, debug: true })
    const socket = adapter.sockets[0]
    socket.welcome()
    const request = module.debug.requestSession({ serverUrl: server, instanceId: 'client' })
    const rejection = expect(request).rejects.toThrow('Connection changed')
    socket.receive({ type: 'result', id: socket.sent.at(-1)!.id, data: { sessionId: 'session', clientId: 'client', configuratorId: 'connection' } })
    module.reset()
    await rejection
    expect(module.debug.sessions).toEqual([])
  })

  it('не логирует mock, если сессия отозвана во время hash', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { module, adapter } = fixture({ role: 'client', allowedServers: [server], debug: true })
    const socket = await approve(module, adapter)
    let resolve!: (hash: string) => void
    vi.spyOn(adapter, 'hashSimulation').mockImplementation(() => new Promise((r) => {
      resolve = r
    }))
    socket.receive({ type: 'runSimulation', id: 'mock', sessionId: 'session', identity: 'sim', expectedHash: 'hash' })
    module.disconnect(server)
    resolve('hash')
    await tick()
    expect(log).not.toHaveBeenCalled()
    expect(socket.sent.some(message => message.type === 'commandResult')).toBe(false)
  })
})
