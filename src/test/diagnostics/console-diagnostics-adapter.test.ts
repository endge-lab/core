import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConsoleDiagnosticsAdapter } from '@/model/adapters/diagnostics/ConsoleDiagnosticsAdapter'

const output = {
  id: 'console',
  name: 'Console',
  enabled: true,
  adapterType: 'console',
  options: { format: 'json' },
}

describe('consoleDiagnosticsAdapter memory safety', () => {
  afterEach(() => vi.restoreAllMocks())

  it('does not serialize telemetry records in snapshots', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const adapter = new ConsoleDiagnosticsAdapter(output)
    const largeBody = 'response-row'.repeat(10_000)

    adapter.acceptSnapshot({
      generatedAt: 1,
      trigger: 'manual',
      telemetry: {
        sessionId: 'session',
        resource: { attributes: {} },
        counters: {} as any,
        records: [{ body: largeBody }] as any,
      },
    }, { output, trigger: 'manual', sessionId: 'session', resource: { attributes: {} } })

    const text = String(log.mock.calls[0]?.[0])
    expect(text).toContain('"telemetryRecords":1')
    expect(text).not.toContain('response-row')
  })

  it('bounds JSON record bodies and keeps only attribute names', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const adapter = new ConsoleDiagnosticsAdapter(output)

    adapter.acceptRecord({
      id: 1,
      signal: 'log',
      timestamp: 1,
      severityNumber: 9,
      severityText: 'INFO',
      body: 'x'.repeat(10_000),
      scope: { name: 'test' },
      attributes: { response: 'secret-response' },
    }, { output, routeIds: ['route'], sessionId: 'session', resource: { attributes: {} } })

    const text = String(log.mock.calls[0]?.[0])
    expect(text.length).toBeLessThan(3_000)
    expect(text).toContain('response')
    expect(text).not.toContain('secret-response')
  })
})
