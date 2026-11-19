// @vitest-environment node
import type { DiagnosticsAdapter } from '@/features/core/modules/diagnostics/domain/types/diagnostics-adapter.type'
import type {
  DiagnosticsLogRecord,
  DiagnosticsSpanRecord,
  EndgeDiagnosticsConfiguration,
} from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'
import { describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { BrowserDiagnosticsSnapshot_Adapter } from '@/features/core/modules/diagnostics/adapters/BrowserDiagnosticsSnapshot_Adapter'
import { EndgeDiagnostics_Module } from '@/features/core/modules/diagnostics/EndgeDiagnostics_Module'

// Создаёт независимую configuration для одного тестового diagnostics module.
function configuration(
  overrides: Partial<EndgeDiagnosticsConfiguration['telemetry']['collection']> = {},
): EndgeDiagnosticsConfiguration {
  return {
    telemetry: {
      collection: {
        enabled: true,
        signals: ['log', 'span'],
        minSeverity: 1,
        maxRecords: 100,
        ...overrides,
      },
      outputs: [],
      routes: [],
    },
    snapshots: {
      content: { telemetry: true, problems: true, configuration: false },
      shortcut: {
        triggerSet: [],
        content: { telemetry: true, problems: true, configuration: false },
      },
      automatic: {
        enabled: false,
        errorCount: 10,
        windowSeconds: 60,
        cooldownSeconds: 300,
        outputIds: [],
      },
    },
  }
}

describe('диагностика Endge', () => {
  it('выгружает ручную запись при выключенном фоне без доставки в фоновые outputs', async () => {
    const diagnostics = new EndgeDiagnostics_Module()
    const download = vi.spyOn(BrowserDiagnosticsSnapshot_Adapter.prototype, 'downloadJson').mockImplementation(() => {})
    const acceptRecord = vi.fn()
    const acceptSnapshot = vi.fn()
    const base = configuration({ enabled: false, maxRecords: 2 })
    base.telemetry.routes = [{ id: 'all', name: 'All', enabled: true, match: {}, outputId: 'memory' }]
    base.snapshots.automatic = { ...base.snapshots.automatic, enabled: true, errorCount: 1, outputIds: ['memory'] }
    diagnostics.configure(base)
    await diagnostics.start({ scope: {}, vars: {} })
    diagnostics.registerAdapter({ id: 'memory', acceptRecord, acceptSnapshot })

    try {
      expect(() => diagnostics.startRecording()).toThrow('Manual recording is disabled')
      expect(diagnostics.info('before recording')).toBeNull()
      const config = { ...base, recording: { enabled: true, content: base.snapshots.content } }
      diagnostics.configure(config)

      const started = diagnostics.startRecording()
      expect(started.status).toBe('recording')
      expect(diagnostics.startRecording()).toEqual(started)
      diagnostics.info('evicted')
      diagnostics.startSpan('kept span').end()
      const unfinished = diagnostics.startSpan('unfinished')
      diagnostics.error('kept log', { attributes: { authorization: 'private' } })

      expect(diagnostics.query()).toEqual([])
      expect(acceptRecord).not.toHaveBeenCalled()
      expect(acceptSnapshot).not.toHaveBeenCalled()
      const stopped = diagnostics.stopRecording({
        domain: false,
        program: false,
        effectiveConfiguration: false,
        runtime: false,
        raphData: false,
        raphGraph: false,
      })
      expect(stopped).toMatchObject({ status: 'stopped', retainedRecords: 2, droppedRecords: 1 })
      expect(unfinished.end()).toBeNull()
      expect(diagnostics.error('after recording')).toBeNull()
      expect(diagnostics.stopRecording()).toEqual(stopped)
      const finished = diagnostics.downloadRecording()
      expect(download).toHaveBeenCalledWith(expect.objectContaining({
        recording: finished,
        telemetry: expect.objectContaining({
          records: [
            expect.objectContaining({ name: 'kept span' }),
            expect.objectContaining({ body: 'kept log', attributes: { authorization: '[REDACTED]' } }),
          ],
        }),
      }))
      diagnostics.downloadRecording(finished.id)
      expect(download.mock.calls[0]).toEqual(download.mock.calls[1])
      Endge.events.emitEvent('context:user-changed', { previous: 'one', value: 'two' })
      expect(diagnostics.recordingState.status).toBe('idle')
      expect(() => diagnostics.downloadRecording(finished.id)).toThrow('unavailable')

      diagnostics.configure({
        ...config,
        telemetry: { ...base.telemetry, collection: { ...base.telemetry.collection, enabled: true } },
      })
      diagnostics.startRecording()
      const regular = diagnostics.info('also collected in the background')
      expect(acceptRecord).toHaveBeenCalledOnce()
      expect(diagnostics.query()).toEqual([regular])
      expect(diagnostics.stopRecording()).toMatchObject({ status: 'stopped', retainedRecords: 1 })
    }
    finally {
      await diagnostics.reset()
      download.mockRestore()
    }
  })

  it('применяет политику severity и сохраняет только ограниченный хвост истории', () => {
    const diagnostics = new EndgeDiagnostics_Module()
    diagnostics.configure(configuration({ minSeverity: 9, maxRecords: 2 }))

    expect(diagnostics.debug('hidden')).toBeNull()
    diagnostics.info('first')
    diagnostics.warn('second')
    diagnostics.error('third')

    expect(diagnostics.query().map(record => (record as DiagnosticsLogRecord).body)).toEqual(['second', 'third'])
    expect(diagnostics.getCounters()).toMatchObject({
      totalRecords: 2,
      droppedByPolicy: 1,
      droppedByCapacity: 1,
      recordsBySignal: { log: 2 },
    })
  })

  it('нормализует correlation, исключения и чувствительные атрибуты', () => {
    const diagnostics = new EndgeDiagnostics_Module()
    diagnostics.configure(configuration())
    const traceId = '0123456789abcdef0123456789abcdef'
    const spanId = '0123456789abcdef'

    const record = diagnostics.recordException(new TypeError('Invalid value'), {
      traceId,
      spanId,
      attributes: {
        component: 'compiler',
        authorizationHeader: 'Bearer private',
      },
    })

    expect(record).toMatchObject({
      signal: 'log',
      severityNumber: 17,
      severityText: 'ERROR',
      eventName: 'exception',
      traceId,
      spanId,
      body: 'Invalid value',
      attributes: {
        'component': 'compiler',
        'authorizationHeader': '[REDACTED]',
        'exception.type': 'TypeError',
        'exception.message': 'Invalid value',
      },
    })
  })

  it('хранит одну завершённую запись на span и связывает дочерние logs', () => {
    const diagnostics = new EndgeDiagnostics_Module()
    diagnostics.configure(configuration())
    const root = diagnostics.startSpan('compile', { startTimestamp: 100 })
    const child = root.startChild('compile.stores', { startTimestamp: 110 })

    const log = child.log({ body: 'phase completed', severityNumber: 9, timestamp: 120 })
    const childRecord = child.end({ status: 'ok', endTimestamp: 140 })
    const rootRecord = root.end({ status: 'ok', endTimestamp: 160 })

    expect(log).toMatchObject({ traceId: root.traceId, spanId: child.spanId })
    expect(childRecord).toMatchObject({
      traceId: root.traceId,
      spanId: child.spanId,
      parentSpanId: root.spanId,
      durationMs: 30,
    })
    expect(rootRecord).toMatchObject({
      traceId: root.traceId,
      spanId: root.spanId,
      durationMs: 60,
    })
    expect(diagnostics.query({ signals: ['span'] }) as DiagnosticsSpanRecord[]).toHaveLength(2)
    expect(diagnostics.getCounters().activeSpans).toBe(0)
    expect(child.end()).toBeNull()
  })

  it('фильтрует подписки, поддерживает replay и изолирует ошибки listeners', () => {
    const diagnostics = new EndgeDiagnostics_Module()
    diagnostics.configure(configuration())
    diagnostics.warn('warning')
    diagnostics.error('error')
    const received: string[] = []

    const unsubscribe = diagnostics.subscribe(
      { signals: ['log'], minSeverity: 17 },
      record => received.push((record as DiagnosticsLogRecord).body),
      { replayStored: true },
    )
    diagnostics.fatal('fatal')
    unsubscribe()
    diagnostics.error('ignored')

    diagnostics.subscribe({}, () => {
      throw new Error('listener failed')
    })
    expect(() => diagnostics.info('safe producer')).not.toThrow()
    expect(received).toEqual(['error', 'fatal'])
    expect(diagnostics.getCounters().listenerFailures).toBe(1)
  })

  it('обогащает logs и spans контекстом, захваченным при начале записи', () => {
    const diagnostics = new EndgeDiagnostics_Module()
    diagnostics.configure(configuration())
    let actor = { 'user.id': 'user-1', 'session.id': 'session-1' }
    const unregister = diagnostics.registerContextProvider('auth', () => actor)

    const log = diagnostics.info('authorized action', {
      attributes: { 'user.id': 'spoofed', 'operation': 'save' },
    })
    const span = diagnostics.startSpan('query.execute', { startTimestamp: 100 })
    actor = { 'user.id': 'user-2', 'session.id': 'session-2' }
    const spanRecord = span.end({ endTimestamp: 130 })

    expect(log?.attributes).toEqual({
      'user.id': 'user-1',
      'session.id': 'session-1',
      'operation': 'save',
    })
    expect(spanRecord?.attributes).toMatchObject({
      'user.id': 'user-1',
      'session.id': 'session-1',
    })
    expect(diagnostics.getCounters().activeContextProviders).toBe(1)

    unregister()
    expect(diagnostics.info('anonymous')?.attributes).toEqual({})
    expect(diagnostics.getCounters().activeContextProviders).toBe(0)
  })

  it('изолирует ошибки провайдера контекста от производителей записей', () => {
    const diagnostics = new EndgeDiagnostics_Module()
    diagnostics.configure(configuration())
    diagnostics.registerContextProvider('broken', () => {
      throw new Error('context failed')
    })

    expect(() => diagnostics.info('still stored')).not.toThrow()
    expect(diagnostics.query()).toHaveLength(1)
    expect(diagnostics.getCounters().contextProviderFailures).toBe(1)
  })

  it('направляет подходящие записи в адаптеры и сбрасывает их по возможности', async () => {
    const diagnostics = new EndgeDiagnostics_Module()
    const accept = vi.fn()
    const flush = vi.fn()
    const adapter: DiagnosticsAdapter = { id: 'memory', acceptRecord: accept, flush }
    diagnostics.configure({
      ...configuration(),
      telemetry: {
        ...configuration().telemetry,
        routes: [{
          id: 'errors',
          name: 'Errors',
          enabled: true,
          match: { signals: ['log'], minSeverity: 17 },
          outputId: 'memory',
        }],
      },
    })
    diagnostics.registerAdapter(adapter)

    diagnostics.info('not routed')
    diagnostics.error('routed')
    const result = await diagnostics.flush()

    expect(accept).toHaveBeenCalledOnce()
    expect(accept.mock.calls[0]?.[0]).toMatchObject({ body: 'routed' })
    expect(accept.mock.calls[0]?.[1]).toMatchObject({ routeIds: ['errors'] })
    expect(flush).toHaveBeenCalledOnce()
    expect(result).toEqual({ succeeded: ['memory'], failed: [] })
    expect(() => diagnostics.registerAdapter(adapter)).toThrow('Adapter "memory" is already registered')
  })

  it('не позволяет отклонённому promise адаптера нарушить работу производителя', async () => {
    const diagnostics = new EndgeDiagnostics_Module()
    diagnostics.configure({
      ...configuration(),
      telemetry: {
        ...configuration().telemetry,
        routes: [{
          id: 'all',
          name: 'All',
          enabled: true,
          match: {},
          outputId: 'broken',
        }],
      },
    })
    diagnostics.registerAdapter({
      id: 'broken',
      acceptRecord: async () => { throw new Error('delivery failed') },
    })

    expect(() => diagnostics.info('still stored')).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()

    expect(diagnostics.query()).toHaveLength(1)
    expect(diagnostics.getCounters().adapterFailures).toBe(1)
  })

  it('однократно направляет запись в output при совпадении нескольких routes', () => {
    const diagnostics = new EndgeDiagnostics_Module()
    const acceptRecord = vi.fn()
    const base = configuration()
    diagnostics.configure({
      ...base,
      telemetry: {
        ...base.telemetry,
        routes: [
          { id: 'runtime', name: 'Runtime', enabled: true, match: { phases: ['runtime'] }, outputId: 'memory' },
          { id: 'errors', name: 'Errors', enabled: true, match: { minSeverity: 17 }, outputId: 'memory' },
        ],
      },
    })
    diagnostics.registerAdapter({ id: 'memory', acceptRecord })

    diagnostics.error('failed', { phase: 'runtime' })

    expect(acceptRecord).toHaveBeenCalledOnce()
    expect(acceptRecord.mock.calls[0]?.[1]).toMatchObject({ routeIds: ['runtime', 'errors'] })
  })

  it('создаёт автоматический snapshot только при достижении порога скользящего окна', () => {
    const diagnostics = new EndgeDiagnostics_Module()
    const acceptSnapshot = vi.fn()
    const base = configuration()
    diagnostics.configure({
      ...base,
      snapshots: {
        ...base.snapshots,
        automatic: {
          enabled: true,
          errorCount: 10,
          windowSeconds: 60,
          cooldownSeconds: 300,
          outputIds: ['memory'],
        },
      },
    })
    diagnostics.registerAdapter({ id: 'memory', acceptRecord: vi.fn(), acceptSnapshot })

    for (let index = 0; index < 9; index += 1) {
      diagnostics.error(`error-${index}`, { timestamp: 1_000 + index })
    }
    expect(acceptSnapshot).not.toHaveBeenCalled()

    diagnostics.error('error-10', { timestamp: 1_010 })
    expect(acceptSnapshot).toHaveBeenCalledOnce()
    expect(acceptSnapshot.mock.calls[0]?.[0]).toMatchObject({ trigger: 'automatic' })

    diagnostics.error('cooldown', { timestamp: 2_000 })
    expect(acceptSnapshot).toHaveBeenCalledOnce()
  })
})
