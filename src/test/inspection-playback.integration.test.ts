import type {
  InspectionRecord,
  InspectionRecording,
  InspectionState,
} from '@/features/core/modules/inspection/types/inspection.types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { createDefaultEndgeConfiguration } from '@/features/core/modules/configuration/domain/endge-configuration'
import { InspectionCapture_Service } from '@/features/core/modules/inspection/services/InspectionCapture_Service'
import { diffInspectionState } from '@/features/core/modules/inspection/tools/inspection-recording'
import { emptyRuntimeInspection } from '@/features/core/modules/runtime/tools/runtime-inspection'

const context = {
  workspace: 'inspection',
  facets: {},
  user: null,
  locale: 'ru',
  theme: 'light',
  timezone: 'UTC',
}
function state(count: number): InspectionState {
  return {
    context,
    runtime: { version: 1, runtime: emptyRuntimeInspection() },
    dataAvailable: true,
    data: { count },
  }
}
function recording(records: InspectionRecord[]): InspectionRecording {
  return {
    version: 1,
    programId: Endge.program.programId!,
    runId: 'run',
    recordingId: 'recording',
    chunks: records.map(record => ({
      firstSequence: record.sequence,
      lastSequence: record.sequence,
      records: [record],
    })),
  }
}
function history(length = 20): InspectionRecord[] {
  const records: InspectionRecord[] = [
    {
      sequence: 0,
      at: 0,
      kind: 'snapshot',
      scope: 'inspection',
      reason: 'initial',
      revision: 0,
      value: state(0),
    },
  ]
  for (let index = 1; index <= length; index++) {
    records.push(
      index % 5 === 0
        ? {
            sequence: index,
            at: index,
            kind: 'snapshot',
            scope: 'inspection',
            reason: 'checkpoint',
            revision: index,
            value: state(index),
          }
        : {
            sequence: index,
            at: index,
            kind: 'delta',
            baseRevision: index - 1,
            revision: index,
            changes: diffInspectionState(state(index - 1), state(index)),
          },
    )
  }
  return records
}
beforeEach(() => {
  const boot = {
    mode: 'debugger',
    scope: { workspaceIdentity: 'inspection' },
    vars: {},
  } as const
  Endge.context.setup(boot)
  Endge.runtime.setup(boot)
  Endge.program.beginCompile('test')
  Endge.program.completeCompile(
    { folders: {}, documents: {} },
    { ...context, configuration: createDefaultEndgeConfiguration() },
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  Endge.inspection.reset()
  Endge.program.clear()
  Endge.context.reset()
  Endge.runtime.setup({ scope: {}, vars: {} })
  Endge.configuration.reset()
})

describe('shared passive inspection player', () => {
  it('applies live deltas once and does not rebuild runtime for informational records', () => {
    const records = history(3)
    Endge.inspection.open(recording(records.slice(0, 1)))
    Endge.inspection.setFollowLive(true)
    const apply = vi.spyOn(Endge.runtime, 'replaceInspectionSnapshot')
    Endge.inspection.appendRecording(recording(records.slice(1)))
    expect(Endge.runtime.inspection.data).toEqual({ count: 3 })
    expect(apply).toHaveBeenCalledTimes(1)
    Endge.inspection.appendRecording(recording([{ sequence: 4, at: 4, kind: 'event', name: 'notice', payload: null }]))
    expect(apply).toHaveBeenCalledTimes(1)
    expect(Endge.inspection.appliedSequence).toBe(4)
    Endge.inspection.seek(0)
    expect(Endge.runtime.inspection.data).toEqual({ count: 0 })
    Endge.inspection.seek(4)
    expect(Endge.runtime.inspection.data).toEqual({ count: 3 })
  })

  it('installs workspace metadata and theme configuration for bundle-only inspection', () => {
    const bundle = Endge.program.exportBundle()
    bundle.catalog.workspace = { identity: 'inspection', displayName: 'Inspected workspace', startupCompositionIdentity: null, documentStructure: 'custom' }
    Endge.workspace.reset()
    Endge.installDebuggerBundle({ format: 'endge-bundle', version: 1, bundle })
    expect(Endge.workspace.isLoaded).toBe(true)
    expect(Endge.workspace.current.displayName).toBe('Inspected workspace')
    expect(Endge.workspace.current.documentStructure).toBe('custom')
    expect(Endge.workspace.themes).toEqual(bundle.context.configuration.themes)
    expect(Endge.context.currentTheme).toBe('light')
    expect(Endge.runtime.getRuntimeHosts()).toHaveLength(0)
    const invalid = structuredClone(bundle)
    invalid.catalog.workspace!.identity = 'other'
    expect(() => Endge.installDebuggerBundle({ format: 'endge-bundle', version: 1, bundle: invalid })).toThrow('Invalid workspace descriptor')
    expect(Endge.workspace.current.identity).toBe('inspection')
  })

  it('applies the initial snapshot, receives while paused, steps and seeks through checkpoints', () => {
    const records = history()
    Endge.inspection.open(recording(records.slice(0, 1)))
    expect(Endge.runtime.inspection.data).toEqual({ count: 0 })
    Endge.inspection.appendRecording(recording(records.slice(1)))
    expect(Endge.inspection.receivedSequence).toBe(20)
    expect(Endge.inspection.appliedSequence).toBe(0)
    expect(Endge.runtime.inspection.data).toEqual({ count: 0 })
    for (let count = 1; count <= 20; count++) {
      Endge.inspection.stepForward()
      expect(Endge.runtime.inspection.data).toEqual({ count })
    }
    for (const count of [9, 2, 20, 0, 17]) {
      Endge.inspection.seek(count)
      expect(Endge.runtime.inspection.data).toEqual({ count })
    }
    Endge.inspection.stepBackward()
    expect(Endge.runtime.inspection.data).toEqual({ count: 16 })
    Endge.inspection.setFollowLive(true)
    expect(Endge.runtime.inspection.data).toEqual({ count: 20 })
    expect(Endge.runtime.getRuntimeHosts()).toEqual([])
  })
  it.each([1, 2, 3, 7, 20])(
    'has identical playback for chunk partition %s',
    (size) => {
      const records = history()
      Endge.inspection.open(recording(records.slice(0, 1)))
      Endge.inspection.setFollowLive(true)
      for (let i = 1; i < records.length; i += size) {
        const part = records.slice(i, i + size)
        Endge.inspection.append({
          firstSequence: part[0]!.sequence,
          lastSequence: part.at(-1)!.sequence,
          records: part,
        })
      }
      expect(Endge.runtime.inspection.data).toEqual({ count: 20 })
    },
  )
  it('ignores exact redelivery, rejects conflicting repeats and keeps failed import atomic', () => {
    const records = history(4)
    Endge.inspection.open(recording(records))
    const before = Endge.inspection.exportRecording()
    Endge.inspection.appendRecording(before)
    Endge.inspection.appendRecording(
      recording(
        records.map(
          record =>
            Object.fromEntries(
              Object.entries(record).reverse(),
            ) as unknown as InspectionRecord,
        ),
      ),
    )
    expect(Endge.inspection.records).toHaveLength(5)
    const changed = structuredClone(records[1]!)
    changed.at++
    expect(() =>
      Endge.inspection.appendRecording(recording([changed])),
    ).toThrow(/Conflicting/)
    expect(() =>
      Endge.inspection.appendRecording({ ...recording([]), runId: 'other' }),
    ).toThrow(/identity/)
    const bad = history(8).slice(5)
    const delta = bad[1] as Extract<InspectionRecord, { kind: 'delta' }>
    delta.baseRevision = 98
    delta.revision = 99
    expect(() => Endge.inspection.appendRecording(recording(bad))).toThrow(
      /revision/,
    )
    expect(Endge.inspection.exportRecording()).toEqual(before)
    expect(Endge.runtime.inspection.data).toEqual({ count: 0 })
  })
  it('requires missing bases, restores after gaps only from a full resync and preserves the earlier range', () => {
    const records = history(10)
    expect(() => Endge.inspection.open(recording(records.slice(1, 4)))).toThrow(
      /Initial/,
    )
    Endge.inspection.open(recording(records.slice(0, 3)))
    expect(() =>
      Endge.inspection.appendRecording(recording(records.slice(7, 8))),
    ).toThrow(/gap/)
    const resync: InspectionRecord = {
      sequence: 8,
      at: 8,
      kind: 'snapshot',
      scope: 'inspection',
      reason: 'resync',
      revision: 8,
      value: state(8),
    }
    Endge.inspection.appendRecording(recording([resync, ...records.slice(9)]))
    expect(() =>
      Endge.inspection.prepare(Endge.inspection.exportRecording()),
    ).not.toThrow()
    expect(Endge.inspection.gaps).toEqual([{ from: 3, to: 7, resumedAt: 8 }])
    Endge.inspection.seek(10)
    expect(Endge.runtime.inspection.data).toEqual({ count: 10 })
    Endge.inspection.seek(2)
    expect(Endge.runtime.inspection.data).toEqual({ count: 2 })
    expect(() => Endge.inspection.seek(5)).toThrow(/unavailable/)
    expect(
      Endge.inspection
        .exportRecording()
        .chunks.flatMap(chunk => chunk.records)
        .some(
          record => record.kind === 'snapshot' && record.reason === 'resync',
        ),
    ).toBe(true)
  })
  it('keeps old sessions separate without mixing runs or duplicating Program', () => {
    const first = recording(history(4))
    Endge.inspection.open(first)
    Endge.inspection.archiveCurrent()
    Endge.inspection.open({
      ...recording(history(1)),
      runId: 'new-run',
      recordingId: 'new-recording',
    })
    expect(Endge.inspection.records).toHaveLength(2)
    expect(Endge.inspection.exportArchived(first.recordingId)).toEqual(first)
    expect(Endge.inspection.archives).toHaveLength(1)
    Endge.inspection.removeArchived(first.recordingId)
    expect(Endge.inspection.archives).toHaveLength(0)
  })
  it('never executes actions or network effects during replay', () => {
    const execute = vi.spyOn(Endge.commands, 'execute')
    const run = vi.spyOn(Endge.runtime, 'execute')
    const records = history(4)
    records.push({
      sequence: 5,
      at: 5,
      kind: 'event',
      name: 'updates:message',
      payload: { url: 'https://example.invalid' },
    })
    Endge.inspection.open(recording(records))
    Endge.inspection.seek(5)
    Endge.inspection.seek(0)
    expect(execute).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })
  it('freezes mutable source values and creates a checkpoint every 500 state updates', () => {
    const live = state(0)
    const capture = new InspectionCapture_Service(
      'program',
      'run',
      true,
      () => live,
    )
    for (let count = 1; count <= 510; count++) {
      (live.data as { count: number }).count = count
      capture.update()
    }
    const records = capture.recording.chunks.flatMap(chunk => chunk.records)
    expect(records[0]).toMatchObject({ value: { data: { count: 0 } } })
    expect(records.filter(record => record.kind === 'delta')).toHaveLength(
      510,
    )
    expect(
      records.filter(
        record =>
          record.kind === 'snapshot' && record.reason === 'checkpoint',
      ),
    ).toHaveLength(1)
    capture.stop()
  })
})
