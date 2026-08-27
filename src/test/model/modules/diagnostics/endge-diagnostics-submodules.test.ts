import type { EndgeBootContext } from '@/domain/types/kernel/bootstrap.types'

import { describe, expect, it, vi } from 'vitest'

import { EndgeDiagnostics } from '@/model/modules/diagnostics/endge-diagnostics'

describe('подмодули EndgeDiagnostics', () => {
  /** Проверяет явную передачу lifecycle каждому подмодулю в прямом порядке. */
  it('передаёт setup, load, build и start подмодулям', async () => {
    const diagnostics = new EndgeDiagnostics()
    const context = {} as EndgeBootContext
    const telemetrySetup = vi.spyOn(diagnostics.telemetry, 'setup').mockResolvedValue()
    const problemsSetup = vi.spyOn(diagnostics.problems, 'setup').mockResolvedValue()
    const telemetryLoad = vi.spyOn(diagnostics.telemetry, 'load').mockResolvedValue()
    const problemsLoad = vi.spyOn(diagnostics.problems, 'load').mockResolvedValue()
    const telemetryBuild = vi.spyOn(diagnostics.telemetry, 'build').mockImplementation(() => {})
    const problemsBuild = vi.spyOn(diagnostics.problems, 'build').mockResolvedValue()
    const telemetryStart = vi.spyOn(diagnostics.telemetry, 'start').mockResolvedValue()
    const problemsStart = vi.spyOn(diagnostics.problems, 'start').mockResolvedValue()

    await diagnostics.setup(context)
    await diagnostics.load(context)
    await diagnostics.build(context)
    await diagnostics.start(context)

    expect(telemetrySetup).toHaveBeenCalledWith(context)
    expect(problemsSetup).toHaveBeenCalledWith(context)
    expect(telemetryLoad).toHaveBeenCalledWith(context)
    expect(problemsLoad).toHaveBeenCalledWith(context)
    expect(telemetryBuild).toHaveBeenCalledWith(context)
    expect(problemsBuild).toHaveBeenCalledWith(context)
    expect(telemetryStart).toHaveBeenCalledWith(context)
    expect(problemsStart).toHaveBeenCalledWith(context)
    expect(telemetrySetup.mock.invocationCallOrder[0]).toBeLessThan(problemsSetup.mock.invocationCallOrder[0])
    expect(telemetryStart.mock.invocationCallOrder[0]).toBeLessThan(problemsStart.mock.invocationCallOrder[0])
  })

  /** Проверяет обратный порядок reset для зависимых подмодулей. */
  it('сбрасывает подмодули в обратном порядке', async () => {
    const diagnostics = new EndgeDiagnostics()
    const telemetryReset = vi.spyOn(diagnostics.telemetry, 'reset').mockResolvedValue()
    const problemsReset = vi.spyOn(diagnostics.problems, 'reset').mockImplementation(() => {})

    await diagnostics.reset()

    expect(problemsReset.mock.invocationCallOrder[0]).toBeLessThan(telemetryReset.mock.invocationCallOrder[0])
  })
})
