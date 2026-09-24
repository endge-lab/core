import { Raph } from '@raphy-js/raph'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { EndgeBundleCodec_Service } from '@/features/core/kernel/services/EndgeBundleCodec_Service'
import { createDefaultEndgeConfiguration } from '@/features/core/modules/configuration/domain/endge-configuration'
import { createUpdateStoreRuntime } from '@/test/fixtures/update-source'

const context = {
  workspace: 'capture',
  facets: {},
  user: null,
  locale: 'ru',
  theme: 'light',
  timezone: 'UTC',
}
afterEach(async () => {
  vi.restoreAllMocks()
  Endge.inspection.reset()
  await Endge.runtime.reset()
  Endge.runtime.setup({ scope: {}, vars: {} })
  Endge.program.clear()
  Endge.domain.reset()
  Endge.context.reset()
  Raph.reset()
})
describe('real Runtime / Context / Raph capture', () => {
  it('records a stream update without Bridge, separates consumers and replays without effects', async () => {
    const runtime = createUpdateStoreRuntime({
      storeSource: 'defineStore({ data: { count: value(0) } })',
      updates: [
        {
          identity: 'from-sse',
          handles: ['CountChanged'],
          source:
            'defineUpdate({ handles: [\'CountChanged\'], mutations: [{ strategy: \'set\', target: \'count\', value: input(\'count\') }] })',
        },
      ],
    })
    Endge.program.completeCompile(
      { folders: {}, documents: {} },
      { ...context, configuration: createDefaultEndgeConfiguration() },
    )
    const lease = vi.spyOn(Endge.runtime, 'acquireDataChanges')
    const privateCapture = Endge.inspection.createCapture({
      includeData: false,
    })
    Endge.inspection.startRecording({ includeData: true })
    expect(lease).toHaveBeenCalledTimes(1)
    runtime.dispatch({
      type: 'CountChanged',
      payload: { count: 7 },
      meta: {
        id: null,
        source: 'sse',
        sourceEvent: 'CountChanged',
        occurredAt: new Date(0).toISOString(),
      },
    })
    Endge.events.emitDynamic('inspection-test:applied', { secret: 7 })
    const expected = Endge.runtime.captureInspection(true)
    const plain = privateCapture.recording.chunks.flatMap(
      chunk => chunk.records,
    )
    expect(
      plain
        .filter(record => record.kind === 'event')
        .every(record => record.payload === null),
    ).toBe(true)
    expect(
      plain
        .filter(record => record.kind === 'snapshot')
        .every(
          record =>
            record.scope !== 'inspection'
            || record.value.dataAvailable === false,
        ),
    ).toBe(true)
    Endge.inspection.stopRecording()
    privateCapture.stop()
    const recording = Endge.inspection.exportRecording()
    const records = recording.chunks.flatMap(chunk => chunk.records)
    expect(
      records.some(
        record =>
          record.kind === 'delta'
          && record.changes.some(change => change.path[0] === 'data'),
      ),
    ).toBe(true)
    expect(
      records.some(
        record =>
          record.kind === 'event' && record.name === 'inspection-test:applied',
      ),
    ).toBe(true)
    const stoppedCount = records.length
    Endge.events.emitDynamic('inspection-test:after-stop', {})
    expect(
      Endge.inspection
        .exportRecording()
        .chunks.flatMap(chunk => chunk.records),
    ).toHaveLength(stoppedCount)
    const codec = new EndgeBundleCodec_Service()
    const decoded = await codec.decode(
      await codec.encode({
        format: 'endge-bundle',
        version: 1,
        inspection: recording,
      }),
    )
    const programId = Endge.program.programId
    Endge.inspection.reset()
    await Endge.runtime.reset()
    const boot = {
      mode: 'debugger',
      scope: { workspaceIdentity: 'capture' },
      vars: {},
    } as const
    Endge.context.setup(boot)
    Endge.runtime.setup(boot)
    expect(Endge.program.programId).toBe(programId)
    const execute = vi.spyOn(Endge.runtime, 'execute')
    const command = vi.spyOn(Endge.commands, 'execute')
    const addPhase = vi.spyOn(Raph, 'addPhase')
    Endge.inspection.open(decoded.inspection!)
    Endge.inspection.seek(records.at(-1)!.sequence)
    expect(Endge.runtime.inspection.data).toEqual(expected.data)
    expect(Endge.runtime.inspection.runtime.hosts).toEqual(
      expected.runtime.hosts,
    )
    expect(execute).not.toHaveBeenCalled()
    expect(command).not.toHaveBeenCalled()
    expect(addPhase).not.toHaveBeenCalled()
  })
})
