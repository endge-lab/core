// @vitest-environment node
import type {
  DiagnosticsAdapterCreateContext,
  DiagnosticsLogRecord,
  DiagnosticsSnapshot,
  EndgeDiagnosticsOutputConfiguration,
} from '@/domain/types/diagnostics'
import { SentryDiagnosticsAdapter } from '@/model/adapters/diagnostics/SentryDiagnosticsAdapter'
import { afterEach, describe, expect, it, vi } from 'vitest'

const OUTPUT: EndgeDiagnosticsOutputConfiguration = {
  id: 'sentry-local',
  name: 'Local Sentry',
  enabled: true,
  adapterType: 'sentry',
  options: {
    dsn: '{{ SENTRY_DSN }}',
    environment: '{{ SENTRY_ENVIRONMENT }}',
    sendSnapshots: true,
  },
}

const CREATE_CONTEXT: DiagnosticsAdapterCreateContext = {
  sessionId: 'session-1',
  resource: {
    attributes: {
      'service.name': 'endge',
      'endge.workspace.id': 'workspace-1',
    },
  },
  resolveVariable: (value) => {
    if (value === '{{ SENTRY_DSN }}')
      return 'http://public-key@localhost:9000/42'
    if (value === '{{ SENTRY_ENVIRONMENT }}')
      return 'test'
    return value
  },
}

/** Создаёт успешный fetch response без зависимости от browser Response. */
function successfulResponse(): Pick<Response, 'ok' | 'status'> {
  return { ok: true, status: 200 }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SentryDiagnosticsAdapter', () => {
  it('resolves DSN and maps an exception log to a Sentry event envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulResponse())
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new SentryDiagnosticsAdapter(OUTPUT, CREATE_CONTEXT)
    const record: DiagnosticsLogRecord = {
      id: 1,
      signal: 'log',
      timestamp: 1_750_000_000_000,
      severityNumber: 17,
      severityText: 'ERROR',
      body: 'Save failed',
      eventName: 'exception',
      scope: { name: 'endge.workspace' },
      attributes: {
        'exception.type': 'TypeError',
        'exception.message': 'Save failed',
        'user.id': 'user-1',
      },
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '0123456789abcdef',
      phase: 'runtime',
    }

    await adapter.acceptRecord(record, {
      ...CREATE_CONTEXT,
      output: OUTPUT,
      routeIds: ['runtime-errors'],
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [requestUrl, request] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(requestUrl).toContain('http://localhost:9000/api/42/envelope/')
    expect(requestUrl).toContain('sentry_key=public-key')

    const lines = String(request.body).split('\n')
    expect(JSON.parse(lines[1])).toMatchObject({ type: 'event' })
    expect(JSON.parse(lines[2])).toMatchObject({
      message: 'Save failed',
      level: 'error',
      environment: 'test',
      user: { id: 'user-1' },
      tags: {
        'endge.signal': 'log',
        'endge.phase': 'runtime',
        'endge.workspace.id': 'workspace-1',
      },
      contexts: {
        trace: {
          trace_id: record.traceId,
          span_id: record.spanId,
          status: 'internal_error',
        },
      },
      exception: {
        values: [{ type: 'TypeError', value: 'Save failed' }],
      },
    })
  })

  it('sends a diagnostics snapshot as a JSON attachment', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulResponse())
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new SentryDiagnosticsAdapter(OUTPUT, CREATE_CONTEXT)
    const snapshot: DiagnosticsSnapshot = {
      generatedAt: 1_750_000_000_000,
      trigger: 'manual',
      problems: { revision: 1, total: 0, problems: [] },
    }

    await adapter.acceptSnapshot(snapshot, {
      ...CREATE_CONTEXT,
      output: OUTPUT,
      trigger: 'manual',
    })

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const lines = String(request.body).split('\n')
    expect(JSON.parse(lines[3])).toMatchObject({
      type: 'attachment',
      content_type: 'application/json',
      attachment_type: 'event.attachment',
    })
    expect(JSON.parse(lines[4])).toEqual(snapshot)
  })

  it('rejects a missing resolved DSN during adapter creation', () => {
    expect(() => new SentryDiagnosticsAdapter(OUTPUT, {
      ...CREATE_CONTEXT,
      resolveVariable: () => undefined,
    })).toThrow('requires a resolved DSN')
  })
})
