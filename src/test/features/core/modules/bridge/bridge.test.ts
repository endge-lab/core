import type { EndgeBootContext } from '@/features/core/kernel/types/bootstrap.types'
import type { EndgeBundle } from '@/features/core/kernel/types/endge-bundle.types'
import type {
  BridgeMessage,
  EndgeBridgeBootOptions,
} from '@/features/core/modules/bridge/domain/bridge.type'
import type { DiagnosticsSnapshot } from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'
import type { InspectionChunk } from '@/features/core/modules/inspection/types/inspection.types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { BrowserBridge_Adapter } from '@/features/core/modules/bridge/adapters/BrowserBridge_Adapter'
import { parseBridgeAllowedServers } from '@/features/core/modules/bridge/config/bridge.config'
import { EndgeBridge_Module } from '@/features/core/modules/bridge/EndgeBridge_Module'
import { createDefaultEndgeConfiguration } from '@/features/core/modules/configuration/domain/endge-configuration'
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
  public send(value: string): void {
    this.sent.push(JSON.parse(value))
  }

  public close(): void {
    this.readyState = 3
  }

  public receive(message: BridgeMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  public welcome(): void {
    this.onopen?.()
    this.receive({
      type: 'welcome',
      data: { protocol: 1, instanceId: 'connection' },
    })
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

  public override subscribePage(): () => void {
    return this.unsubscribe
  }
}

const server = 'https://config.example.com'
const secondServer = 'https://other.example.com'
const modules: EndgeBridge_Module[] = []

function fixture(options?: EndgeBridgeBootOptions) {
  Endge.program.beginCompile('test')
  Endge.program.completeCompile(
    { folders: {}, documents: {} },
    {
      ...Endge.context.serialize(),
      configuration: createDefaultEndgeConfiguration(),
    },
  )
  const adapter = new FakeAdapter()
  const simulation = Object.assign(new RSimulation(), {
    source: 'simulation source',
    sourceVersion: 1,
  })
  const snapshot = vi
    .spyOn(Endge.diagnostics, 'snapshot')
    .mockImplementation(
      () =>
        ({ generatedAt: 1, trigger: 'manual' }) satisfies DiagnosticsSnapshot,
    )
  vi.spyOn(Endge.domain, 'getSimulationByIdentity').mockImplementation(
    identity => (identity === 'sim' ? simulation : null),
  )
  const module = new EndgeBridge_Module(adapter)
  modules.push(module)
  module.setup({
    scope: { workspaceIdentity: 'workspace' },
    bridge: options,
  } as EndgeBootContext)
  module.start()
  return { module, adapter, simulation, snapshot }
}

async function tick() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

async function approve(
  module: EndgeBridge_Module,
  adapter: FakeAdapter,
  sessionId = 'session',
) {
  const socket = adapter.sockets[0]
  socket.welcome()
  socket.receive({
    type: 'sessionRequested',
    data: {
      sessionId,
      displayName: 'Developer',
      workspaceIdentity: 'workspace',
      expiresAt: Date.now() + 45_000,
    },
  })
  module.debug.respondToConsent(module.debug.pendingConsent!, true)
  await tick()
  socket.receive({
    type: 'sessionStarted',
    data: { sessionId, clientId: 'connection', configuratorId: 'config' },
  })
  return socket
}

afterEach(() => {
  for (const module of modules.splice(0)) {
    module.reset()
  }
  Endge.inspection.reset()
  Endge.program.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('политика и lifecycle bridge', () => {
  it('исключает данные на отправителе, включая payload событий, по умолчанию', async () => {
    const { module, adapter, snapshot } = fixture({
      role: 'client',
      allowedServers: [server],
      debug: true,
    })
    const socket = await approve(module, adapter)
    const lease = vi.spyOn(Endge.runtime, 'acquireDataChanges')
    const capture = vi
      .spyOn(Endge.runtime, 'captureInspection')
      .mockReturnValue(inspectionFixture())
    socket.receive({
      type: 'setInspectionOptions',
      id: 'options',
      sessionId: 'session',
      data: { intervalMs: 0, includeData: false, protocolVersion: 1 },
    })
    socket.receive({
      type: 'startContextSync',
      id: 'start',
      sessionId: 'session',
    })
    expect(snapshot).not.toHaveBeenCalled()
    expect(capture).toHaveBeenCalledWith(false)
    expect(lease).not.toHaveBeenCalled()
    const initial = socket.sent.find(message => message.id === 'start')!
      .data as EndgeBundle
    expect(initial).toMatchObject({
      format: 'endge-bundle',
      version: 1,
      bundle: { programId: Endge.program.programId },
    })
    Endge.events.emitEvent('updates:message', {
      type: 'rows',
      message: { secret: 'hidden' },
    })
    expect(JSON.stringify(socket.sent)).not.toContain('hidden')
    expect(socket.sent.at(-1)).toMatchObject({
      type: 'inspectionChunk',
      data: {
        records: [expect.objectContaining({ kind: 'event', payload: null })],
      },
    })
    socket.receive({ type: 'sessionEnded', sessionId: 'session' })
    const count = socket.sent.length
    Endge.events.emitEvent('runtime:data-changed', { revision: 1 })
    expect(socket.sent).toHaveLength(count)
  })

  it('требует подтверждение версии протокола до начального контейнера', async () => {
    const { module, adapter } = fixture({
      role: 'configurator',
      serverUrl: server,
      debug: true,
    })
    const socket = adapter.sockets[0]!
    socket.welcome()
    const requested = module.debug.requestSession({
      serverUrl: server,
      instanceId: 'client',
    })
    socket.receive({
      type: 'result',
      id: socket.sent.at(-1)!.id,
      data: {
        sessionId: 'session',
        clientId: 'client',
        configuratorId: 'connection',
      },
    })
    await requested
    const starting = module.debug.startContextSync('session')
    expect(socket.sent.at(-1)).toMatchObject({
      type: 'setInspectionOptions',
      data: { protocolVersion: 1, includeData: false },
    })
    const rejected = expect(starting).rejects.toThrow('update client Core')
    socket.receive({
      type: 'result',
      id: socket.sent.at(-1)!.id,
      data: { includeData: false },
    })
    await rejected
    expect(
      socket.sent.some(message => message.type === 'startContextSync'),
    ).toBe(false)
  })

  it('передаёт чанки общему журналу после установки контейнера, без обратных действий', async () => {
    const { module, adapter } = fixture({
      role: 'configurator',
      serverUrl: server,
      debug: true,
    })
    const socket = adapter.sockets[0]!
    socket.welcome()
    const requested = module.debug.requestSession({
      serverUrl: server,
      instanceId: 'client',
    })
    socket.receive({
      type: 'result',
      id: socket.sent.at(-1)!.id,
      data: {
        sessionId: 'session',
        clientId: 'client',
        configuratorId: 'connection',
      },
    })
    await requested
    const append = vi
      .spyOn(Endge.inspection, 'append')
      .mockImplementation(() => {})
    const execute = vi.spyOn(Endge.commands, 'execute')
    const starting = module.debug.startContextSync('session')
    socket.receive({
      type: 'result',
      id: socket.sent.at(-1)!.id,
      data: { includeData: false, protocolVersion: 1 },
    })
    await tick()
    const chunk: InspectionChunk = {
      firstSequence: 1,
      lastSequence: 1,
      records: [
        { sequence: 1, at: 1, kind: 'event', name: 'observed', payload: null },
      ],
    }
    socket.receive({
      type: 'inspectionChunk',
      sessionId: 'session',
      data: chunk,
    })
    expect(append).not.toHaveBeenCalled()
    socket.receive({
      type: 'result',
      id: socket.sent.at(-1)!.id,
      data: {
        format: 'endge-bundle',
        version: 1,
        bundle: Endge.program.exportBundle(),
      },
    })
    await starting
    module.debug.activateContextSync('session', 0)
    expect(append).toHaveBeenCalledWith(chunk)
    socket.receive({
      type: 'inspectionChunk',
      sessionId: 'session',
      data: chunk,
    })
    expect(append).toHaveBeenCalledTimes(2) // The shared journal owns exact duplicate detection.
    expect(execute).not.toHaveBeenCalled()
    socket.receive({ type: 'sessionEnded', sessionId: 'session' })
    socket.receive({
      type: 'inspectionChunk',
      sessionId: 'session',
      data: chunk,
    })
    expect(append).toHaveBeenCalledTimes(2)
  })

  it('пакетная доставка сохраняет каждый зафиксированный шаг и освобождает подписки', async () => {
    const { module, adapter } = fixture({
      role: 'client',
      allowedServers: [server],
      debug: true,
    })
    const socket = await approve(module, adapter)
    vi.useFakeTimers()
    const release = vi.fn()
    vi.spyOn(Endge.runtime, 'acquireDataChanges').mockReturnValue({ release })
    let count = 0
    vi.spyOn(Endge.runtime, 'captureInspection').mockImplementation(() => ({
      ...inspectionFixture(),
      data: { count },
    }))
    socket.receive({
      type: 'setInspectionOptions',
      id: 'options',
      sessionId: 'session',
      data: { intervalMs: 1000, includeData: true, protocolVersion: 1 },
    })
    socket.receive({
      type: 'startContextSync',
      id: 'start',
      sessionId: 'session',
    })
    for (count = 1; count <= 10; count++) {
      Endge.events.emitEvent('runtime:data-changed', { revision: count })
    }
    expect(
      socket.sent.filter(message => message.type === 'inspectionChunk'),
    ).toHaveLength(0)
    vi.advanceTimersByTime(1000)
    const records = socket.sent
      .filter(message => message.type === 'inspectionChunk')
      .flatMap(message => (message.data as InspectionChunk).records)
    expect(records.filter(record => record.kind === 'delta')).toHaveLength(
      10,
    )
    expect(records.map(record => record.sequence)).toEqual(
      Array.from({ length: records.length }, (_, index) => index),
    )
    socket.receive({ type: 'sessionEnded', sessionId: 'session' })
    expect(release).toHaveBeenCalledOnce()
    const before = socket.sent.length
    Endge.events.emitEvent('runtime:data-changed', { revision: 12 })
    vi.advanceTimersByTime(2000)
    expect(socket.sent).toHaveLength(before)
    module.reset()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('отклоняет слишком большой начальный снимок явно', async () => {
    const { module, adapter } = fixture({
      role: 'client',
      allowedServers: [server],
      debug: true,
    })
    const socket = await approve(module, adapter)
    vi.spyOn(Endge.runtime, 'acquireDataChanges').mockReturnValue({
      release: vi.fn(),
    })
    vi.spyOn(Endge.runtime, 'captureInspection').mockReturnValue({
      ...inspectionFixture(),
      data: 'x'.repeat(15 * 1024 * 1024),
    })
    socket.receive({
      type: 'setInspectionOptions',
      id: 'options',
      sessionId: 'session',
      data: { includeData: true, protocolVersion: 1 },
    })
    socket.receive({
      type: 'startContextSync',
      id: 'start',
      sessionId: 'session',
    })
    expect(socket.sent.at(-1)).toMatchObject({
      type: 'commandResult',
      id: 'start',
      error: expect.stringMatching(/limit|MiB/),
    })
  })

  it('меняет policy отдельного capture и прикладывает полный снимок после включения данных', async () => {
    const { module, adapter } = fixture({
      role: 'client',
      allowedServers: [server],
      debug: true,
    })
    const socket = await approve(module, adapter)
    const release = vi.fn()
    const lease = vi
      .spyOn(Endge.runtime, 'acquireDataChanges')
      .mockReturnValue({ release })
    vi.spyOn(Endge.runtime, 'captureInspection').mockImplementation(
      include => ({
        ...inspectionFixture(),
        ...(include ? { data: { private: 42 } } : {}),
      }),
    )
    socket.receive({
      type: 'startContextSync',
      id: 'start',
      sessionId: 'session',
    })
    expect(lease).not.toHaveBeenCalled()
    socket.receive({
      type: 'setInspectionOptions',
      id: 'on',
      sessionId: 'session',
      data: { includeData: true, protocolVersion: 1 },
    })
    expect(lease).toHaveBeenCalledOnce()
    const records = socket.sent
      .filter(message => message.type === 'inspectionChunk')
      .flatMap(message => (message.data as InspectionChunk).records)
    expect(records).toContainEqual(
      expect.objectContaining({
        kind: 'snapshot',
        scope: 'inspection',
        value: expect.objectContaining({
          data: { private: 42 },
          dataAvailable: true,
        }),
      }),
    )
    socket.receive({
      type: 'setInspectionOptions',
      id: 'off',
      sessionId: 'session',
      data: { includeData: false, protocolVersion: 1 },
    })
    expect(release).toHaveBeenCalledOnce()
  })

  it('отклоняет несовместимую версию и некорректные интервалы', async () => {
    const { module, adapter } = fixture({
      role: 'client',
      allowedServers: [server],
      debug: true,
    })
    const socket = await approve(module, adapter)
    for (const intervalMs of [-1, 1000.5, 60001, '1000']) {
      socket.receive({
        type: 'setInspectionOptions',
        id: 'invalid',
        sessionId: 'session',
        data: { intervalMs },
      })
      expect(socket.sent.at(-1)?.error).toContain('interval')
    }
    socket.receive({
      type: 'setInspectionOptions',
      id: 'version',
      sessionId: 'session',
      data: { protocolVersion: 99 },
    })
    expect(socket.sent.at(-1)?.error).toContain('protocol')
  })

  it('выполняет только команду активной клиентской сессии и не отвечает после её завершения', async () => {
    const { module, adapter } = fixture({
      role: 'client',
      allowedServers: [server],
      debug: true,
    })
    const socket = await approve(module, adapter)
    let complete!: () => void
    const execute = vi.spyOn(Endge.commands, 'execute').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve
        }),
    )
    const command = {
      type: 'executeCommand',
      id: 'command',
      sessionId: 'session',
      data: { type: 'context:set-locale', payload: { locale: 'en' } },
    }
    socket.receive({ ...command, sessionId: 'other' })
    expect(execute).not.toHaveBeenCalled()
    socket.receive(command)
    expect(execute).toHaveBeenCalledWith(command.data)
    socket.receive({ type: 'sessionEnded', sessionId: 'session' })
    complete()
    await tick()
    expect(
      socket.sent.some(m => m.type === 'commandResult' && m.id === 'command'),
    ).toBe(false)
  })

  it('отзывает зависшее соединение по heartbeat timeout и освобождает watchdog при reset', () => {
    vi.useFakeTimers()
    const { module, adapter } = fixture({
      role: 'client',
      allowedServers: [server],
      debug: true,
    })
    adapter.sockets[0].welcome()
    vi.advanceTimersByTime(75_000)
    expect(adapter.sockets[0].readyState).toBe(3)
    expect(module.connections[0]).toMatchObject({
      status: 'reconnecting',
      error: 'Server heartbeat timed out',
    })
    module.reset()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('нормализует CSV, запрещает credentials и остаётся выключенным без boot policy', () => {
    expect(
      parseBridgeAllowedServers(` ${server}/, ,${server},${secondServer}`),
    ).toEqual([server, secondServer])
    expect(() =>
      parseBridgeAllowedServers('https://user:secret@example.com'),
    ).toThrow()
    const { adapter } = fixture()
    expect(adapter.sockets).toHaveLength(0)
  })

  it('владеет одним соединением и отменяет reconnect при reset', () => {
    vi.useFakeTimers()
    const { module, adapter } = fixture({
      role: 'client',
      allowedServers: [server],
      debug: true,
    })
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
    const { module, adapter } = fixture({
      role: 'client',
      allowedServers: [server, secondServer],
      debug: true,
    })
    for (const socket of adapter.sockets) {
      socket.welcome()
    }
    const request = {
      type: 'sessionRequested',
      data: {
        sessionId: 'one',
        displayName: 'Developer',
        workspaceIdentity: 'workspace',
        expiresAt: Date.now() + 45_000,
      },
    }
    adapter.sockets[0].receive(request)
    adapter.sockets[1].receive({
      ...request,
      data: { ...request.data, sessionId: 'two' },
    })
    const pending = module.debug.pendingConsent!
    expect(pending).toMatchObject({ serverUrl: server, sessionId: 'one' })
    expect(adapter.sockets[1].sent.at(-1)).toMatchObject({
      type: 'acceptSession',
      accepted: false,
    })
    module.disconnect(server)
    expect(module.debug.pendingConsent).toBeNull()
    expect(module.debug.respondToConsent(pending, true)).toBe(false)
    await tick()
    expect(
      adapter.sockets[0].sent.some(m => m.type === 'acceptSession'),
    ).toBe(false)
    expect(module.debug.sessions).toEqual([])
  })

  it('ожидает явного ответа UI и acknowledgement до выполнения команд', () => {
    const { module, adapter, snapshot } = fixture({
      role: 'client',
      allowedServers: [server],
      debug: true,
    })
    const socket = adapter.sockets[0]
    socket.welcome()
    socket.receive({
      type: 'sessionRequested',
      data: {
        sessionId: 'one',
        displayName: 'Developer',
        workspaceIdentity: 'workspace',
        expiresAt: Date.now() + 45_000,
      },
    })
    const pending = module.debug.pendingConsent!
    expect(Object.isFrozen(pending)).toBe(true)
    expect(
      socket.sent.some(message => message.type === 'acceptSession'),
    ).toBe(false)
    const started = {
      type: 'sessionStarted',
      data: {
        sessionId: 'one',
        clientId: 'connection',
        configuratorId: 'config',
      },
    }
    socket.receive(started)
    socket.receive({ type: 'getSnapshot', id: 'premature', sessionId: 'one' })
    expect(snapshot).not.toHaveBeenCalled()
    expect(
      module.debug.respondToConsent(
        { ...pending, serverUrl: secondServer },
        true,
      ),
    ).toBe(false)
    expect(module.debug.respondToConsent(pending, true)).toBe(true)
    expect(module.debug.pendingConsent).toBeNull()
    expect(socket.sent.at(-1)).toMatchObject({
      type: 'acceptSession',
      accepted: true,
    })
    socket.receive({ type: 'getSnapshot', id: 'before-ack', sessionId: 'one' })
    expect(snapshot).not.toHaveBeenCalled()
    socket.receive(started)
    socket.receive({ type: 'getSnapshot', id: 'after-ack', sessionId: 'one' })
    expect(snapshot).toHaveBeenCalledOnce()
    expect(module.debug.respondToConsent(pending, true)).toBe(false)
  })

  it('снимает отказанный и отозванный запрос без сохранения согласия', () => {
    const { module, adapter } = fixture({
      role: 'client',
      allowedServers: [server],
      debug: true,
    })
    const socket = adapter.sockets[0]
    socket.welcome()
    const data = {
      sessionId: 'one',
      displayName: 'Developer',
      workspaceIdentity: 'workspace',
      expiresAt: Date.now() + 45_000,
    }
    socket.receive({ type: 'sessionRequested', data })
    const first = module.debug.pendingConsent!
    module.debug.respondToConsent(first, false)
    expect(socket.sent.at(-1)).toMatchObject({
      type: 'acceptSession',
      accepted: false,
    })
    socket.receive({
      type: 'sessionRequested',
      data: { ...data, sessionId: 'two' },
    })
    expect(module.debug.respondToConsent(first, true)).toBe(false)
    expect(module.debug.pendingConsent?.sessionId).toBe('two')
    socket.receive({ type: 'sessionEnded', sessionId: 'two' })
    expect(module.debug.pendingConsent).toBeNull()
    socket.receive({
      type: 'sessionRequested',
      data: { ...data, sessionId: 'three' },
    })
    const third = module.debug.pendingConsent!
    module.reset()
    expect(module.debug.pendingConsent).toBeNull()
    expect(module.debug.respondToConsent(third, true)).toBe(false)
  })

  it('закрывает запрос по deadline и отвергает поздний клик даже при задержанном timer', () => {
    vi.useFakeTimers()
    const { module, adapter } = fixture({
      role: 'client',
      allowedServers: [server],
      debug: true,
    })
    const socket = adapter.sockets[0]
    socket.welcome()
    const request = (sessionId: string) =>
      socket.receive({
        type: 'sessionRequested',
        data: {
          sessionId,
          displayName: 'Developer',
          workspaceIdentity: 'workspace',
          expiresAt: Date.now() + 1000,
        },
      })
    request('one')
    const first = module.debug.pendingConsent!
    vi.advanceTimersByTime(1000)
    expect(module.debug.pendingConsent).toBeNull()
    expect(socket.sent.at(-1)).toMatchObject({
      type: 'acceptSession',
      accepted: false,
    })
    expect(module.debug.respondToConsent(first, true)).toBe(false)
    request('two')
    const second = module.debug.pendingConsent!
    vi.setSystemTime(Date.now() + 2000)
    module.debug.respondToConsent(second, true)
    expect(socket.sent.at(-1)).toMatchObject({
      type: 'acceptSession',
      sessionId: 'two',
      accepted: false,
    })
    expect(module.debug.pendingConsent).toBeNull()
    module.reset()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('проверяет source до mock и делегирует сбор snapshot диагностике', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { module, adapter, snapshot } = fixture({
      role: 'client',
      allowedServers: [server],
      debug: true,
    })
    const socket = await approve(module, adapter)
    socket.receive({
      type: 'runSimulation',
      id: 'missing',
      sessionId: 'session',
      identity: 'missing',
      expectedHash: 'x',
    })
    await tick()
    expect(socket.sent.at(-1)?.data).toEqual({
      status: 'rejected',
      reason: 'not-found',
    })
    socket.receive({
      type: 'runSimulation',
      id: 'mismatch',
      sessionId: 'session',
      identity: 'sim',
      expectedHash: 'x',
    })
    await tick()
    expect(socket.sent.at(-1)?.data).toEqual({
      status: 'rejected',
      reason: 'hash-mismatch',
    })
    expect(log).not.toHaveBeenCalled()
    const hash = await module.debug.getSimulationHash('sim')
    socket.receive({
      type: 'runSimulation',
      id: 'match',
      sessionId: 'session',
      identity: 'sim',
      expectedHash: hash,
    })
    await tick()
    expect(socket.sent.at(-1)?.data).toEqual({
      status: 'mocked',
      identity: 'sim',
      hash,
    })
    expect(log).toHaveBeenCalledOnce()
    socket.receive({
      type: 'getSnapshot',
      id: 'snapshot',
      sessionId: 'session',
    })
    expect(snapshot).toHaveBeenCalledOnce()
    expect(snapshot).toHaveBeenCalledWith({
      includeTelemetry: false,
      includeProblems: false,
      includeConfiguration: true,
      includeEffectiveConfiguration: true,
      includeDomain: true,
      includeProgram: false,
      includeRuntime: true,
      includeRaphData: false,
      includeRaphGraph: false,
    })
    expect(socket.sent.at(-1)?.data).toEqual({
      generatedAt: 1,
      trigger: 'manual',
    })
    module.disconnect(server)
    expect(module.debug.sessions).toEqual([])
  })

  it('завершает pending requests ошибкой при закрытии транспорта', async () => {
    const { module, adapter } = fixture({
      role: 'configurator',
      serverUrl: server,
      debug: true,
    })
    const socket = adapter.sockets[0]
    socket.welcome()
    const request = module.debug.requestSession({
      serverUrl: server,
      instanceId: 'client',
    })
    const rejection = expect(request).rejects.toThrow('Connection closed')
    module.disconnect(server)
    await rejection
    expect(module.debug.sessions).toEqual([])
  })

  it('считает уникальных пользователей и сохраняет отдельные подключения', () => {
    const { module, adapter } = fixture({
      role: 'configurator',
      serverUrl: server,
    })
    adapter.sockets[0].welcome()
    adapter.sockets[0].receive({
      type: 'configurators',
      data: [
        {
          instanceId: 'one',
          userId: 'user',
          displayName: 'Developer',
          label: 'Tab 1',
        },
        {
          instanceId: 'two',
          userId: 'user',
          displayName: 'Developer',
          label: 'Tab 2',
        },
      ],
    })
    expect(module.configurator.connections).toHaveLength(2)
    expect(module.configurator.participants).toMatchObject([
      { connectionCount: 2 },
    ])
    module.disconnect(server)
    expect(module.configurator.participants).toEqual([])
  })

  it('не восстанавливает сессию из ответа, обработанного после reset', async () => {
    const { module, adapter } = fixture({
      role: 'configurator',
      serverUrl: server,
      debug: true,
    })
    const socket = adapter.sockets[0]
    socket.welcome()
    const request = module.debug.requestSession({
      serverUrl: server,
      instanceId: 'client',
    })
    const rejection = expect(request).rejects.toThrow('Connection changed')
    socket.receive({
      type: 'result',
      id: socket.sent.at(-1)!.id,
      data: {
        sessionId: 'session',
        clientId: 'client',
        configuratorId: 'connection',
      },
    })
    module.reset()
    await rejection
    expect(module.debug.sessions).toEqual([])
  })

  it('не логирует mock, если сессия отозвана во время hash', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { module, adapter } = fixture({
      role: 'client',
      allowedServers: [server],
      debug: true,
    })
    const socket = await approve(module, adapter)
    let resolve!: (hash: string) => void
    vi.spyOn(adapter, 'hashSimulation').mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    socket.receive({
      type: 'runSimulation',
      id: 'mock',
      sessionId: 'session',
      identity: 'sim',
      expectedHash: 'hash',
    })
    module.disconnect(server)
    resolve('hash')
    await tick()
    expect(log).not.toHaveBeenCalled()
    expect(
      socket.sent.some(message => message.type === 'commandResult'),
    ).toBe(false)
  })
})
