// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { EndgeDiagnostics } from '@/model/endge/diagnostics/endge-diagnostics'
import { createDiagnosticsEntityOwner, EndgeProblems } from '@/model/endge/diagnostics/endge-problems'
import { RMock } from '@/domain/entities/reflect/RMock'

describe('EndgeProblems', () => {
  it('атомарно заменяет problems одного entity owner', () => {
    const problems = new EndgeProblems()
    const owner = createDiagnosticsEntityOwner({
      entityType: 'component-sfc',
      id: 'component-1',
      identity: 'flight-table',
    })

    problems.replace(owner, [
      { severity: 'error', code: 'template.invalid', message: 'Template invalid', sourcePath: 'template' },
    ])
    expect(problems.query({ entityIdentity: 'flight-table' })).toHaveLength(1)

    problems.replace(owner, [])
    expect(problems.query()).toEqual([])
  })

  it('поддерживает upsert и resolve persistent runtime problems', () => {
    const problems = new EndgeProblems()
    const owner = { key: 'runtime:host-1', phase: 'runtime' as const, runtimeId: 'host-1' }

    problems.upsert(owner, { key: 'failed', severity: 'error', code: 'runtime.failed', message: 'Failed' })
    problems.upsert(owner, { key: 'failed', severity: 'error', code: 'runtime.failed', message: 'Still failed' })

    expect(problems.query({ runtimeId: 'host-1' })).toHaveLength(1)
    expect(problems.query()[0]?.message).toBe('Still failed')
    expect(problems.resolve(owner.key, 'failed')).toBe(true)
    expect(problems.query()).toEqual([])
  })

  it('уведомляет telemetry и problems subscribers независимо', async () => {
    const diagnostics = new EndgeDiagnostics()
    const telemetryListener = vi.fn()
    const problemsListener = vi.fn()
    diagnostics.telemetry.subscribe(telemetryListener)
    diagnostics.problems.subscribe(problemsListener)

    diagnostics.info('log')
    await Promise.resolve()
    expect(telemetryListener).toHaveBeenCalledTimes(1)
    expect(problemsListener).not.toHaveBeenCalled()

    diagnostics.problems.replace(
      { key: 'build:project', phase: 'build' },
      [{ severity: 'warning', code: 'project.warning', message: 'Warning' }],
    )
    expect(problemsListener).toHaveBeenCalledTimes(1)
    expect(telemetryListener).toHaveBeenCalledTimes(1)
  })

  it('получает pure entity validation без сохранения validationErrors', () => {
    const mock = RMock.fromPlain({
      id: 1,
      identity: '',
      displayName: '',
      contentSource: 'document',
      contentType: 'application/json',
      source: '{',
    })

    expect(mock.getDiagnosticProblems().map(problem => problem.code)).toEqual([
      'mock.identity.required',
      'mock.display-name.required',
      'mock.source.json-invalid',
    ])
    expect('validationErrors' in mock).toBe(false)
  })
})
