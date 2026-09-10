import type { EndgeBootContext } from '@/features/core/kernel/types/bootstrap.types'
import type { BridgeMessage, EndgeBridgeBootOptions } from '@/features/core/modules/bridge/domain/bridge.type'
import type { DiagnosticsSnapshot } from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { BrowserBridge_Adapter } from '@/features/core/modules/bridge/adapters/BrowserBridge_Adapter'
import { parseBridgeAllowedServers } from '@/features/core/modules/bridge/config/bridge.config'
import { EndgeBridge_Module } from '@/features/core/modules/bridge/EndgeBridge_Module'
import { RSimulation } from '@/features/core/modules/domain/entities/RSimulation'
import { inspectionFixture } from '../runtime/fixtures/runtime-inspection'

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
  /** Начальный snapshot, данные и статусы имеют общую последовательность без обратных Commands. */
  it('применяет буферизованные Runtime и данные в порядке потока и отзывает сеанс при разрыве', async () => {
    const { module, adapter } = fixture({ role: 'configurator', serverUrl: server, debug: true })
    const socket = adapter.sockets[0]!
    socket.welcome()
    const requested = module.debug.requestSession({ serverUrl: server, instanceId: 'client' })
    socket.receive({ type: 'result', id: socket.sent.at(-1)!.id, data: { sessionId: 'session', clientId: 'client', configuratorId: 'connection' } })
    await requested
    const order: string[] = []
    vi.spyOn(Endge.runtime, 'applyInspectionSnapshot').mockImplementation(() => {
      order.push('runtime')
    })
    vi.spyOn(Endge.runtime, 'applyInspectionData').mockImplementation(() => {
      order.push('data')
    })
    vi.spyOn(Endge.runtime, 'applyInspectionEvent').mockImplementation(() => {
      order.push('status')
    })
    const execute = vi.spyOn(Endge.commands, 'execute')
    const starting = module.debug.startContextSync('session')
    const requestId = socket.sent.at(-1)!.id
    const update = (sequence: number, value: unknown) => socket.receive({ type: 'inspectionSnapshot', sessionId: 'session', data: { sequence, update: value } })
    update(1, { kind: 'runtime', snapshot: inspectionFixture() })
    update(2, { kind: 'data', data: { fresh: true }, generatedAt: 20 })
    socket.receive({ type: 'clientEvent', sessionId: 'session', data: { sequence: 3, event: { sequence: 1, at: 20, name: 'runtime:host-status-changed', payload: { id: 'host-0', previous: 'running', value: 'paused' } } } })
    expect(order).toEqual([])
    socket.receive({ type: 'result', id: requestId, data: { snapshot: { format: 'endge-diagnostics-snapshot', version: 2 }, sequence: 0 } })
    module.debug.activateContextSync('session', (await starting).sequence)
    expect(order).toEqual(['runtime', 'data', 'status'])
    update(2, { kind: 'data', data: { old: true }, generatedAt: 10 })
    expect(order).toHaveLength(3)
    expect(execute).not.toHaveBeenCalled()
    update(5, { kind: 'data', data: {}, generatedAt: 30 })
    await tick()
    expect(module.debug.sessions).toEqual([])
  })

  /** Непрерывный поток не отодвигает deadline, а отсутствие изменений не создаёт снимки. */
  it('ограничивает частоту данных, объединяет топологию и освобождает timers и lease', async () => {
    const { module, adapter } = fixture({ role: 'client', allowedServers: [server], debug: true })
    const socket = await approve(module, adapter)
    socket.receive({ type: 'startContextSync', id: 'start', sessionId: 'session' })
    vi.useFakeTimers()
    const release = vi.fn()
    vi.spyOn(Endge.runtime, 'acquireDataChanges').mockReturnValue({ release })
    const capture = vi.spyOn(Endge.runtime, 'captureInspectionData').mockReturnValue({ data: { rows: [1] }, generatedAt: 1 })
    vi.spyOn(Endge.runtime, 'captureInspection').mockReturnValue(inspectionFixture())
    socket.receive({ type: 'setInspectionOptions', id: 'options', sessionId: 'session', data: { intervalMs: 1000 } })
    expect(capture).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(capture).toHaveBeenCalledTimes(1)
    for (let index = 0; index < 10; index++) {
      Endge.events.emitEvent('runtime:data-changed', { revision: index })
      vi.advanceTimersByTime(100)
    }
    expect(capture).toHaveBeenCalledTimes(2)
    expect(socket.sent.some(m => m.type === 'clientEvent' && (m.data as any).event.name === 'runtime:data-changed')).toBe(false)
    for (let index = 0; index < 10; index++) {
      Endge.events.emitEvent('runtime:scopes-changed', {})
    }
    vi.advanceTimersByTime(0)
    expect(socket.sent.filter(m => m.type === 'inspectionSnapshot' && (m.data as any).update.kind === 'runtime')).toHaveLength(1)
    socket.receive({ type: 'sessionEnded', sessionId: 'session' })
    expect(release).toHaveBeenCalledOnce()
    const count = socket.sent.length
    Endge.events.emitEvent('runtime:data-changed', { revision: 100 })
    vi.advanceTimersByTime(2000)
    expect(socket.sent).toHaveLength(count)
    module.reset()
    expect(vi.getTimerCount()).toBe(0)
  })

  /** Слишком большой snapshot не расходует sequence и не выдаётся за успешное обновление. */
  it('помечает превышение размера и сохраняет непрерывность после следующего успешного снимка', async () => {
    const { module, adapter } = fixture({ role: 'client', allowedServers: [server], debug: true })
    const socket = await approve(module, adapter)
    socket.receive({ type: 'startContextSync', id: 'start', sessionId: 'session' })
    const huge = { ...inspectionFixture(), data: 'x'.repeat(15 * 1024 * 1024) }
    const capture = vi.spyOn(Endge.runtime, 'captureInspection').mockReturnValue(huge)
    socket.receive({ type: 'refreshInspection', id: 'too-large', sessionId: 'session' })
    expect(socket.sent.at(-2)).toMatchObject({ type: 'inspectionSnapshot', data: { sequence: 1, update: { kind: 'data-error' } } })
    expect(socket.sent.at(-1)).toMatchObject({ type: 'commandResult', id: 'too-large', error: expect.stringContaining('size limit') })
    capture.mockReturnValue(inspectionFixture())
    socket.receive({ type: 'refreshInspection', id: 'refresh', sessionId: 'session' })
    expect(socket.sent.at(-2)).toMatchObject({ type: 'inspectionSnapshot', data: { sequence: 2, update: { kind: 'runtime' } } })
    expect(socket.sent.at(-1)).toMatchObject({ type: 'commandResult', id: 'refresh', data: null })
  })

  /** Некорректная частота отклоняется до создания подписки на локальный Raph. */
  it('отклоняет некорректные интервалы и не оставляет автообновление после выключения', async () => {
    const { module, adapter } = fixture({ role: 'client', allowedServers: [server], debug: true })
    const socket = await approve(module, adapter)
    socket.receive({ type: 'startContextSync', id: 'start', sessionId: 'session' })
    const release = vi.fn()
    const acquire = vi.spyOn(Endge.runtime, 'acquireDataChanges').mockReturnValue({ release })
    vi.spyOn(Endge.runtime, 'captureInspectionData').mockReturnValue({ data: {}, generatedAt: 1 })
    for (const intervalMs of [-1, 1, 999, 1000.5, 60001, '1000']) {
      socket.receive({ type: 'setInspectionOptions', id: 'invalid', sessionId: 'session', data: { intervalMs } })
      expect(socket.sent.at(-1)?.error).toContain('interval')
    }
    expect(acquire).not.toHaveBeenCalled()
    socket.receive({ type: 'setInspectionOptions', id: 'on', sessionId: 'session', data: { intervalMs: 1000 } })
    socket.receive({ type: 'setInspectionOptions', id: 'off', sessionId: 'session', data: { intervalMs: 0 } })
    expect(release).toHaveBeenCalledOnce()
    module.reset()
    expect(release).toHaveBeenCalledOnce()
  })

  it('публикует события только после согласия и начала sync, прекращает после отзыва', async () => {
    const { module, adapter } = fixture({ role: 'client', allowedServers: [server], debug: true })
    const socket = await approve(module, adapter)
    const publish = () => Endge.events.emitEvent('context:locale-changed', { previous: 'ru', value: 'en' })
    publish()
    expect(socket.sent.filter(m => m.type === 'clientEvent')).toHaveLength(0)
    socket.receive({ type: 'startContextSync', id: 'snapshot', sessionId: 'session' })
    expect(socket.sent.at(-1)?.data).toMatchObject({ sequence: 0 })
    publish()
    expect(socket.sent.at(-1)).toMatchObject({ type: 'clientEvent', sessionId: 'session', data: { sequence: 1, event: { name: 'context:locale-changed' } } })
    socket.receive({ type: 'sessionEnded', sessionId: 'session' })
    publish()
    expect(socket.sent.filter(m => m.type === 'clientEvent')).toHaveLength(1)
  })

  it('буферизует события до snapshot, пропускает дубликаты и не возвращает команду клиенту', async () => {
    const { module, adapter } = fixture({ role: 'configurator', serverUrl: server, debug: true })
    const socket = adapter.sockets[0]
    socket.welcome()
    const session = module.debug.requestSession({ serverUrl: server, instanceId: 'client' })
    socket.receive({ type: 'result', id: socket.sent.at(-1)!.id, data: { sessionId: 'session', clientId: 'client', configuratorId: 'connection' } })
    await session
    const apply = vi.spyOn(Endge.context, 'applyEvent').mockImplementation(() => {})
    const execute = vi.spyOn(Endge.commands, 'execute')
    await expect(module.debug.executeCommand('session', { type: 'context:set-locale', payload: { locale: 'en' } })).rejects.toThrow('not ready')
    const snapshot = module.debug.startContextSync('session')
    const requestId = socket.sent.at(-1)!.id
    const event = (sequence: number, sessionId = 'session', value: unknown = 'en') => socket.receive({ type: 'clientEvent', sessionId, data: { sequence, event: { name: 'context:locale-changed', at: 1, sequence, payload: { previous: 'ru', value } } } })
    event(1)
    event(2)
    event(3, 'unrelated')
    expect(apply).not.toHaveBeenCalled()
    socket.receive({ type: 'result', id: requestId, data: { snapshot: { format: 'endge-diagnostics-snapshot', version: 2 }, sequence: 1 } })
    const initial = await snapshot
    module.debug.activateContextSync('session', initial.sequence)
    expect(apply).toHaveBeenCalledTimes(1)
    event(2)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
    expect(socket.sent.some(m => m.type === 'clientEvent' || m.type === 'executeCommand')).toBe(false)
    event(3, 'session', 42)
    await tick()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(module.debug.sessions).toEqual([])
  })

  it('выполняет только команду активной клиентской сессии и не отвечает после её завершения', async () => {
    const { module, adapter } = fixture({ role: 'client', allowedServers: [server], debug: true })
    const socket = await approve(module, adapter)
    let complete!: () => void
    const execute = vi.spyOn(Endge.commands, 'execute').mockImplementation(() => new Promise<void>((resolve) => {
      complete = resolve
    }))
    const command = { type: 'executeCommand', id: 'command', sessionId: 'session', data: { type: 'context:set-locale', payload: { locale: 'en' } } }
    socket.receive({ ...command, sessionId: 'other' })
    expect(execute).not.toHaveBeenCalled()
    socket.receive(command)
    expect(execute).toHaveBeenCalledWith(command.data)
    socket.receive({ type: 'sessionEnded', sessionId: 'session' })
    complete()
    await tick()
    expect(socket.sent.some(m => m.type === 'commandResult' && m.id === 'command')).toBe(false)
  })

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
