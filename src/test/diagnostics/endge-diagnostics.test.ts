// @vitest-environment node
import type {
  DiagnosticsAdapter,
  DiagnosticsLogRecord,
  DiagnosticsSpanRecord,
  EndgeDiagnosticsConfiguration,
} from '@/domain/types/diagnostics'
import { EndgeDiagnostics } from '@/model/endge/diagnostics/endge-diagnostics'
import { describe, expect, it, vi } from 'vitest'

/** Создаёт независимую configuration для одного тестового diagnostics module. */
function configuration(
  overrides: Partial<EndgeDiagnosticsConfiguration['collection']> = {},
): EndgeDiagnosticsConfiguration {
  return {
    collection: {
      enabled: true,
      signals: ['log', 'span'],
      minSeverity: 1,
      maxRecords: 100,
      ...overrides,
    },
    routes: [],
  }
}

describe('EndgeDiagnostics', () => {
  it('applies severity policy and keeps only the bounded history tail', () => {
    const diagnostics = new EndgeDiagnostics()
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

  it('normalizes correlation, exceptions and sensitive attributes', () => {
    const diagnostics = new EndgeDiagnostics()
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
        component: 'compiler',
        authorizationHeader: '[REDACTED]',
        'exception.type': 'TypeError',
        'exception.message': 'Invalid value',
      },
    })
  })

  it('stores one completed record per span and links child logs', () => {
    const diagnostics = new EndgeDiagnostics()
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

  it('filters subscriptions, supports replay and isolates listener errors', () => {
    const diagnostics = new EndgeDiagnostics()
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

    diagnostics.subscribe({}, () => { throw new Error('listener failed') })
    expect(() => diagnostics.info('safe producer')).not.toThrow()
    expect(received).toEqual(['error', 'fatal'])
    expect(diagnostics.getCounters().listenerFailures).toBe(1)
  })

  it('enriches logs and spans with context captured at record start', () => {
    const diagnostics = new EndgeDiagnostics()
    diagnostics.configure(configuration())
    let actor = { 'user.id': 'user-1', 'session.id': 'session-1' }
    const unregister = diagnostics.registerContextProvider('auth', () => actor)

    const log = diagnostics.info('authorized action', {
      attributes: { 'user.id': 'spoofed', operation: 'save' },
    })
    const span = diagnostics.startSpan('query.execute', { startTimestamp: 100 })
    actor = { 'user.id': 'user-2', 'session.id': 'session-2' }
    const spanRecord = span.end({ endTimestamp: 130 })

    expect(log?.attributes).toEqual({
      'user.id': 'user-1',
      'session.id': 'session-1',
      operation: 'save',
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

  it('isolates context provider errors from record producers', () => {
    const diagnostics = new EndgeDiagnostics()
    diagnostics.configure(configuration())
    diagnostics.registerContextProvider('broken', () => { throw new Error('context failed') })

    expect(() => diagnostics.info('still stored')).not.toThrow()
    expect(diagnostics.query()).toHaveLength(1)
    expect(diagnostics.getCounters().contextProviderFailures).toBe(1)
  })

  it('routes matching records to adapters and flushes them best-effort', async () => {
    const diagnostics = new EndgeDiagnostics()
    const accept = vi.fn()
    const flush = vi.fn()
    const adapter: DiagnosticsAdapter = { id: 'memory', accept, flush }
    diagnostics.configure({
      ...configuration(),
      routes: [{
        id: 'errors',
        enabled: true,
        match: { signals: ['log'], minSeverity: 17 },
        target: { adapterId: 'memory', integrationId: 'sentry-main' },
      }],
    })
    diagnostics.registerAdapter(adapter)

    diagnostics.info('not routed')
    diagnostics.error('routed')
    const result = await diagnostics.flush()

    expect(accept).toHaveBeenCalledOnce()
    expect(accept.mock.calls[0]?.[0]).toMatchObject({ body: 'routed' })
    expect(accept.mock.calls[0]?.[1]).toMatchObject({ routeId: 'errors', integrationId: 'sentry-main' })
    expect(flush).toHaveBeenCalledOnce()
    expect(result).toEqual({ succeeded: ['memory'], failed: [] })
    expect(() => diagnostics.registerAdapter(adapter)).toThrow('Adapter "memory" is already registered')
  })

  it('does not let a rejected adapter promise break the producer', async () => {
    const diagnostics = new EndgeDiagnostics()
    diagnostics.configure({
      ...configuration(),
      routes: [{
        id: 'all',
        enabled: true,
        match: {},
        target: { adapterId: 'broken' },
      }],
    })
    diagnostics.registerAdapter({
      id: 'broken',
      accept: async () => { throw new Error('delivery failed') },
    })

    expect(() => diagnostics.info('still stored')).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()

    expect(diagnostics.query()).toHaveLength(1)
    expect(diagnostics.getCounters().adapterFailures).toBe(1)
  })
})
