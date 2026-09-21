import type { EndgeBundle } from '@/features/core/kernel/types/endge-bundle.types'
import type {
  InspectionRecord,
  InspectionState,
} from '@/features/core/modules/inspection/types/inspection.types'
import { describe, expect, it, vi } from 'vitest'
import {
  EndgeBundleCodec_Service,
  readEndgeBundle,
} from '@/features/core/kernel/services/EndgeBundleCodec_Service'
import { copyBundleJson } from '@/features/core/kernel/tools/bundle-json'
import { compileComponentSFC } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-compile'
import { createDefaultEndgeConfiguration } from '@/features/core/modules/configuration/domain/endge-configuration'
import { InspectionCapture_Service } from '@/features/core/modules/inspection/services/InspectionCapture_Service'
import {
  diffInspectionState,
  readInspectionChunk,
  readInspectionRecording,
  reduceInspectionRecord,
} from '@/features/core/modules/inspection/tools/inspection-recording'
import { EndgeProgram_Module } from '@/features/core/modules/program/EndgeProgram_Module'
import { emptyRuntimeInspection } from '@/features/core/modules/runtime/tools/runtime-inspection'

const context = {
  workspace: 'demo',
  facets: {},
  user: null,
  locale: 'ru',
  theme: 'light',
  timezone: 'UTC',
}
function state(count = 0): InspectionState {
  return {
    context,
    runtime: { version: 1, runtime: emptyRuntimeInspection() },
    data: { count, rows: [1, 2] },
    dataAvailable: true,
  }
}
function snapshot(): InspectionRecord {
  return {
    sequence: 0,
    at: 0,
    kind: 'snapshot',
    scope: 'inspection',
    reason: 'initial',
    revision: 0,
    value: state(),
  }
}
function bundle(): EndgeBundle {
  return {
    format: 'endge-bundle',
    version: 1,
    inspection: {
      version: 1,
      programId: 'program',
      runId: 'run',
      recordingId: 'recording',
      chunks: [{ firstSequence: 0, lastSequence: 0, records: [snapshot()] }],
    },
  }
}

describe('endge Bundle file boundary', () => {
  for (const format of ['json', 'gzip'] as const) {
    it(`round trips ${format} through the same schema`, async () => {
      const codec = new EndgeBundleCodec_Service()
      expect(await codec.decode(await codec.encode(bundle(), format))).toEqual(
        bundle(),
      )
    })
  }
  it('accepts JSON BOM and whitespace independently of filenames', async () => {
    const bytes = new TextEncoder().encode(
      `\uFEFF \n${JSON.stringify(bundle())}`,
    )
    expect(await new EndgeBundleCodec_Service().decode(bytes)).toEqual(
      bundle(),
    )
  })
  it('rejects corrupt and truncated gzip including a wrong checksum', async () => {
    const codec = new EndgeBundleCodec_Service()
    const bytes = await codec.encode(bundle())
    await expect(codec.decode(bytes.slice(0, -3))).rejects.toThrow()
    bytes[bytes.length - 8]! ^= 1
    await expect(codec.decode(bytes)).rejects.toThrow(/checksum/)
  })
  it('limits decompressed output while reading a compressed stream', async () => {
    const bytes = await new EndgeBundleCodec_Service().encode(bundle())
    await expect(
      new EndgeBundleCodec_Service({ maxDecodedBytes: 512 }).decode(bytes),
    ).rejects.toThrow(/limit/)
  })
  it('cancels file work', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      new EndgeBundleCodec_Service().encode(
        bundle(),
        'gzip',
        controller.signal,
      ),
    ).rejects.toThrow()
  })
  it('rejects empty and unknown versions', () => {
    expect(() =>
      readEndgeBundle({ format: 'endge-bundle', version: 1 }),
    ).toThrow()
    expect(() => readEndgeBundle({ ...bundle(), version: 2 })).toThrow()
  })
  it('does not invoke accessors or hide non-portable values', () => {
    expect(() => copyBundleJson({ value: () => 1 })).toThrow()
    expect(() => copyBundleJson(new Map())).toThrow()
    expect(() =>
      copyBundleJson({
        get value() {
          throw new Error('getter executed')
        },
      }),
    ).toThrow(/Accessor/)
    const value: Record<string, unknown> = {}
    value.self = value
    expect(() => copyBundleJson(value)).toThrow(/Cyclic/)
  })
})

describe('inspection state semantics', () => {
  it('replaces a full snapshot without inheriting later data', () => {
    const initial = snapshot()
    expect(reduceInspectionRecord(state(100), 8, initial).state).toEqual(
      state(0),
    )
  })
  it('patches nested objects, replaces arrays and removes values', () => {
    const next = state(5)
    next.data = { count: 5, added: null, rows: [3] }
    const previous = state()
    previous.data = { count: 0, removed: true, rows: [1, 2] }
    const changes = diffInspectionState(previous, next)
    expect(changes).toContainEqual({ op: 'remove', path: ['data', 'removed'] })
    expect(changes).toContainEqual({
      op: 'set',
      path: ['data', 'rows'],
      value: [3],
    })
    expect(
      reduceInspectionRecord(previous, 0, {
        sequence: 1,
        at: 1,
        kind: 'delta',
        baseRevision: 0,
        revision: 1,
        changes,
      }).state,
    ).toEqual(next)
    expect(previous.data).toHaveProperty('removed', true)
  })
  it('requires initial state and matching revision', () => {
    const record: InspectionRecord = {
      sequence: 1,
      at: 1,
      kind: 'delta',
      baseRevision: 0,
      revision: 1,
      changes: [],
    }
    expect(() => reduceInspectionRecord(null, -1, record)).toThrow(/Initial/)
    expect(() => reduceInspectionRecord(state(), 9, record)).toThrow(
      /revision/,
    )
  })
  it('rejects prototype paths and inconsistent chunk ranges', () => {
    const record = {
      sequence: 1,
      at: 1,
      kind: 'delta',
      baseRevision: 0,
      revision: 1,
      changes: [{ op: 'set', path: ['data', '__proto__'], value: {} }],
    }
    expect(() =>
      readInspectionChunk({
        firstSequence: 1,
        lastSequence: 1,
        records: [record],
      }),
    ).toThrow(/path/)
    expect(() =>
      readInspectionChunk({
        firstSequence: 1,
        lastSequence: 9,
        records: [snapshot()],
      }),
    ).toThrow(/range/)
  })
  it('has identical results for deterministic mutation sequences and chunk boundaries', () => {
    const records = [snapshot()]
    let previous = state()
    for (let index = 1; index <= 80; index++) {
      const next = state((index * 7919) % 101)
      records.push({
        sequence: index,
        at: index,
        kind: 'delta',
        baseRevision: index - 1,
        revision: index,
        changes: diffInspectionState(previous, next),
      })
      previous = next
    }
    for (const size of [1, 2, 7, 19, 81]) {
      const chunks = []
      for (let index = 0; index < records.length; index += size) {
        const part = records.slice(index, index + size)
        chunks.push({
          firstSequence: part[0]!.sequence,
          lastSequence: part.at(-1)!.sequence,
          records: part,
        })
      }
      const validated = readInspectionRecording({
        ...bundle().inspection,
        chunks,
      })
      let current: InspectionState | null = null
      let revision = -1
      for (const chunk of validated.chunks) {
        for (const record of chunk.records) {
          const applied = reduceInspectionRecord(current, revision, record)
          current = applied.state
          revision = applied.revision
        }
      }
      expect(current).toEqual(previous)
    }
  })
  it('freezes capture values at receipt and does not expose its stored history', () => {
    let live = state()
    const capture = new InspectionCapture_Service(
      'program',
      'run',
      true,
      () => live,
    )
    live = state(1)
    capture.update()
    const recording = capture.recording
    live.data = { count: 100 }
    recording.chunks[0]!.records.length = 0
    expect(capture.recording.chunks[0]!.records[0]).toEqual(
      expect.objectContaining({ value: state(0) }),
    )
    expect(capture.recording.chunks[1]!.records[0]).toEqual(
      expect.objectContaining({ kind: 'delta' }),
    )
    capture.stop()
  })
})

describe('program ownership', () => {
  it('requires a completed build and preserves program identity across exports', () => {
    const program = new EndgeProgram_Module()
    program.beginCompile('test')
    expect(() => program.exportBundle()).toThrow(/compilation/)
    program.completeCompile(
      { folders: {}, documents: {} },
      { ...context, configuration: createDefaultEndgeConfiguration() },
    )
    const original = program.exportBundle()
    expect(program.exportBundle({ includeAst: true }).programId).toBe(
      original.programId,
    )
    const other = new EndgeProgram_Module()
    other.installBundle(other.prepareInstall(original))
    expect(other.exportBundle()).toEqual(original)
    expect(() => other.prepareInstall({ ...original, version: 9 })).toThrow()
    expect(other.programId).toBe(original.programId)
  })
})

describe('recording boundaries', () => {
  it('rejects the count limit before copying a huge input', () => {
    const records = Array.from({ length: 100001 }, () => snapshot())
    expect(() =>
      readInspectionRecording({
        ...bundle().inspection,
        chunks: [{ firstSequence: 0, lastSequence: 100000, records }],
      }),
    ).toThrow(/limit/)
  })
  it('releases the consumer when delivery rejects an oversized update', () => {
    let value = state()
    const release = vi.fn()
    const capture = new InspectionCapture_Service(
      'program',
      'run',
      true,
      () => value,
      (chunk) => {
        if (chunk.records.some(record => record.kind === 'delta')) {
          throw new Error('Snapshot exceeds transport limit')
        }
      },
    )
    capture.attach(release)
    value = state(1)
    capture.update()
    expect(capture.stopped).toBe(true)
    expect(release).toHaveBeenCalledTimes(1)
    expect(
      capture.recording.chunks
        .flatMap(chunk => chunk.records)
        .map(record => record.sequence),
    ).toEqual([0, 1])
    expect(capture.recording.chunks.at(-1)!.records[0]).toMatchObject({
      kind: 'marker',
      name: 'error',
    })
  })
})

describe('aST transport independence', () => {
  it('keeps template comments in AST without changing executable IR', () => {
    const simple = compileComponentSFC('<template><Text>Hello</Text></template>')
    const commented = compileComponentSFC('<template><!-- retained --><Text>Hello</Text><!-- end --></template>')
    const semantic = (value: unknown) => JSON.parse(JSON.stringify(value, (key, item) => key === 'sourceRange' ? undefined : item))
    expect(semantic(commented.ir)).toEqual(semantic(simple.ir))
    expect(JSON.stringify(commented.ast)).toContain('retained')
    expect(JSON.stringify(commented.ir)).not.toContain('retained')
  })

  it('cancels decoding after a gzip worker has started', async () => {
    const codec = new EndgeBundleCodec_Service()
    const bytes = await codec.encode(bundle())
    const controller = new AbortController()
    const pending = codec.decode(bytes, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow()
  })
})

it('stops accumulation at 100000 records, releases subscriptions and retains export', () => {
  const value = state()
  const release = vi.fn()
  const capture = new InspectionCapture_Service('program', 'run', false, () => value)
  capture.attach(release)
  for (let index = 0; index < 100005; index++) {
    capture.update({ name: 'tick', payload: null })
  }
  expect(capture.stopped).toBe(true)
  expect(capture.count).toBe(100000)
  expect(release).toHaveBeenCalledTimes(1)
  const result = capture.recording
  expect(result.chunks.at(-1)!.records[0]).toMatchObject({ kind: 'marker', name: 'stopped' })
  expect(() => readInspectionRecording(result)).not.toThrow()
}, 30000)
