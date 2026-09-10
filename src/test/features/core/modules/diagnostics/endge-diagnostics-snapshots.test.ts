import { afterEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { serializeDiagnosticsJson } from '@/features/core/modules/diagnostics/domain/diagnostics-snapshot'
import { EndgeDomain_Module } from '@/features/core/modules/domain/EndgeDomain_Module'

const content = {
  includeTelemetry: false,
  includeProblems: false,
  includeConfiguration: false,
  includeEffectiveConfiguration: false,
  includeDomain: false,
  includeProgram: false,
  includeRuntime: false,
  includeRaphData: false,
  includeRaphGraph: false,
} as const

afterEach(() => vi.restoreAllMocks())

describe('снимок через public API владельцев Core', () => {
  it('сохраняет тип политики AuthProfile при redaction токенов и credentials', () => {
    const result = serializeDiagnosticsJson({ authProfiles: [{
      id: 1,
      identity: 'auth',
      adapterId: 'bearer',
      credentials: { token: 'private-value' },
      session: { storage: 'memory', persistRefreshToken: false },
    }] })
    const domain = EndgeDomain_Module.fromPlain(result.value)
    expect(domain.getAuthProfiles()[0]?.session?.persistRefreshToken).toBe(false)
    expect(JSON.stringify(result.value)).not.toContain('private-value')
    expect(serializeDiagnosticsJson({ persistRefreshToken: 'private-value' }).value).toEqual({ persistRefreshToken: '[REDACTED]' })
  })
  it('собирает настоящее дерево без повторного чтения Diagnostics и выключенных секций', () => {
    const diagnostics = vi.spyOn(Endge.diagnostics, 'createDiagnosticsSnapshot')
    const domain = vi.spyOn(Endge.domain, 'createDiagnosticsSnapshot')
    const raph = vi.spyOn(Endge.runtime, 'snapshotRaph')

    const snapshot = Endge.diagnostics.snapshot(content)

    expect(snapshot.version).toBe(2)
    expect(snapshot.federation).toMatchObject({ id: 'endge' })
    expect(snapshot.federation).toMatchObject({ nodes: expect.arrayContaining([
      expect.objectContaining({ key: 'diagnostics', status: 'referenced', snapshotRef: '#/' }),
      expect.objectContaining({ key: 'domain', status: 'skipped' }),
    ]) })
    expect(diagnostics).not.toHaveBeenCalled()
    expect(domain).not.toHaveBeenCalled()
    expect(raph).not.toHaveBeenCalled()
    expect(snapshot).not.toHaveProperty('domain')
    expect(snapshot).not.toHaveProperty('raph')
  })

  it('собирает Domain один раз и сохраняет redaction прямой проекции Raph', () => {
    const domainState = Endge.domain.createDiagnosticsSnapshot()
    const domain = vi.spyOn(Endge.domain, 'createDiagnosticsSnapshot').mockReturnValue(domainState)
    const raph = vi.spyOn(Endge.runtime, 'snapshotRaph').mockReturnValue({ data: { token: 'private', count: 2 } })

    const snapshot = Endge.diagnostics.snapshot({ ...content, includeDomain: true, includeRaphData: true })

    expect(domain).toHaveBeenCalledOnce()
    expect(snapshot.domain).toEqual(domainState)
    expect(snapshot.federation).toMatchObject({ nodes: expect.arrayContaining([
      expect.objectContaining({ key: 'domain', status: 'referenced', snapshotRef: '#/domain' }),
    ]) })
    expect(raph).toHaveBeenCalledWith({ includeData: true, includeGraph: false })
    expect(snapshot.raph).toEqual({ data: { token: '[REDACTED]', count: 2 } })
    expect(snapshot.redaction?.applied).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain('private')
  })

  it('локализует сбой Raph и сохраняет остальной снимок', () => {
    vi.spyOn(Endge.runtime, 'snapshotRaph').mockImplementation(() => {
      throw new Error('Raph unavailable')
    })

    const snapshot = Endge.diagnostics.snapshot({ ...content, includeRaphGraph: true })

    expect(snapshot.federation).toMatchObject({ id: 'endge' })
    expect(snapshot.raph).toBeNull()
    expect(snapshot.captureErrors).toContainEqual({ section: 'raph', message: 'Raph unavailable' })
  })
})
