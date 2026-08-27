import type { ComponentSFCEventPort } from '@/domain/types/component/sfc/ports.types'
import type { ComponentSFCProgramPayload, ProgramArtifact } from '@/domain/types/program/program.types'

import type {
  RuntimeArtifactReader,
  RuntimeBoundaryPatch,
  RuntimeHostUpdateContext,
} from '@/domain/types/runtime/runtime-host.types'
import { Raph } from '@endge/raph'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { RQuery } from '@/domain/entities/reflect/RQuery'
import { ComponentSFCRuntimeHost } from '@/domain/entities/runtime/hosts/ComponentSFCRuntimeHost'
import { RuntimeBoundaryUpdatePhase } from '@/model/helpers/raph-phases/runtime-boundary-update-phase'
import { Endge } from '@/model/kernel/endge'
import { OperationHistory } from '@/model/modules/runtime/operation/operation-history'
import { compileComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-compile'

describe('componentSFCRuntimeHost', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    Endge.styles.reset()
    Endge.domain.reset()
    Raph.app.reset()
    Raph.clearPhases()
  })

  it('acquires scoped style on first instance and releases it after the last instance', () => {
    const source = `<template><Text part="label">Hello</Text></template>
<style lang="endgecss" scoped>
::part(label) { color: red; }
</style>`
    const artifact = createSFCArtifact(compileComponentSFC(source))
    const model = RComponentSFC.fromPlain({ id: 1, identity: 'test-sfc-table', name: 'Styled SFC', source })
    const reader: RuntimeArtifactReader = {
      getArtifact: <TPayload>() => artifact as unknown as ProgramArtifact<TPayload>,
    }
    const first = ComponentSFCRuntimeHost.createRuntime({
      id: 'styled-1',
      model,
      meta: { runtimeScopeId: 'scope:test' },
      artifactReader: reader,
    })
    const second = ComponentSFCRuntimeHost.createRuntime({
      id: 'styled-2',
      model,
      meta: { runtimeScopeId: 'scope:test' },
      artifactReader: reader,
    })

    expect(Endge.styles.getActivePlacements()).toHaveLength(1)
    expect(Endge.styles.getActivePlacements()[0].referenceCount).toBe(2)
    first.pause()
    second.pause()
    expect(Endge.styles.getActivePlacements()).toEqual([])
    first.resume()
    expect(Endge.styles.getActivePlacements()).toHaveLength(1)
    first.destroy()
    expect(Endge.styles.getActivePlacements()).toEqual([])
    second.resume()
    expect(Endge.styles.getActivePlacements()[0].referenceCount).toBe(1)
    second.destroy()
    expect(Endge.styles.getActivePlacements()).toEqual([])
  })

  it('emits table column boundary patch for Raph-backed row field update', () => {
    const source = `<script setup lang="ts">
defineProps<{
  flights: FlightLeg[]
}>()
</script>

<template>
<Table :rows="flights" row-key="id">
  <Column key="number" title="Flight">
    <Cell>
      <Text>{{ row.number }} ({{ row.counter }})</Text>
    </Cell>
  </Column>
</Table>
</template>`
    const compileResult = compileComponentSFC(source)
    const artifact = createSFCArtifact(compileResult)
    const model = RComponentSFC.fromPlain({
      id: 1,
      identity: 'test-sfc-table',
      name: 'Test SFC Table',
      source,
    })
    const reader: RuntimeArtifactReader = {
      getArtifact: <TPayload>() => artifact as unknown as ProgramArtifact<TPayload>,
    }
    const patches: RuntimeBoundaryPatch[] = []
    const propsUpdates: RuntimeHostUpdateContext[] = []
    let host: ComponentSFCRuntimeHost | null = null

    Raph.app.reset()
    Raph.definePhases([
      RuntimeBoundaryUpdatePhase.make({
        resolveHost: runtimeId => runtimeId === 'runtime-1' ? host as any : null,
      }),
    ])

    host = ComponentSFCRuntimeHost.createRuntime({
      id: 'runtime-1',
      model,
      meta: {
        input: {
          kind: 'raph',
          bindings: {
            flights: { path: 'test.sfc.flights' },
          },
        },
      },
      artifactReader: reader,
    })
    host.on('boundary:dirty', (patch: RuntimeBoundaryPatch) => patches.push(patch))
    host.on('props:dirty', (ctx: RuntimeHostUpdateContext) => propsUpdates.push(ctx))

    Raph.set('test.sfc.flights', [{
      id: 'flight-1',
      number: 'SU 1402',
      counter: 0,
    }])
    patches.length = 0
    propsUpdates.length = 0

    Raph.set('test.sfc.flights[0].counter', 1)

    expect(propsUpdates).toHaveLength(0)
    expect(patches).toHaveLength(1)
    expect(patches[0]).toMatchObject({
      kind: 'collection-projection-update',
      boundaryType: 'table',
      sourcePath: 'test.sfc.flights',
      itemIndex: 0,
      itemKey: 'flight-1',
      changedPaths: [['counter']],
      affectedProjections: [
        expect.objectContaining({
          key: 'number',
          index: 0,
        }),
      ],
      itemSnapshot: expect.objectContaining({
        counter: 1,
      }),
    })

    patches.length = 0
    Raph.set('test.sfc.flights[id="flight-1"].number', 'SSE-1')

    expect(propsUpdates).toHaveLength(0)
    expect(patches).toHaveLength(1)
    expect(patches[0]).toMatchObject({
      kind: 'collection-projection-update',
      sourcePath: 'test.sfc.flights',
      itemIndex: 0,
      itemKey: 'flight-1',
      changedPaths: [['number']],
      affectedProjections: [
        expect.objectContaining({
          key: 'number',
          index: 0,
        }),
      ],
      itemSnapshot: expect.objectContaining({
        number: 'SSE-1',
      }),
    })

    patches.length = 0
    Raph.set('test.sfc.flights[id="flight-1"]', {
      id: 'flight-1',
      number: 'SSE-2',
      counter: 1,
    })

    expect(propsUpdates).toHaveLength(0)
    expect(patches).toHaveLength(1)
    expect(patches[0]).toMatchObject({
      kind: 'collection-projection-update',
      sourcePath: 'test.sfc.flights',
      itemIndex: 0,
      itemKey: 'flight-1',
      changedPaths: [[]],
      affectedProjections: [
        expect.objectContaining({
          key: 'number',
          index: 0,
        }),
      ],
      itemSnapshot: expect.objectContaining({
        number: 'SSE-2',
      }),
    })

    Raph.set('test.sfc.flights', [
      { id: 'flight-1', number: 'SSE-2', counter: 1 },
      { id: 'flight-2', number: 'S7 101', counter: 0 },
    ])
    patches.length = 0
    propsUpdates.length = 0
    Raph.transaction(() => {
      Raph.set('test.sfc.flights[id="flight-1"].counter', 2)
      Raph.set('test.sfc.flights[id="flight-2"].counter', 1)
    })

    expect(propsUpdates).toHaveLength(0)
    expect(patches).toHaveLength(1)
    expect(patches[0]).toMatchObject({
      kind: 'collection-projection-batch',
      sourcePath: 'test.sfc.flights',
      items: [
        expect.objectContaining({ itemIndex: 0, itemKey: 'flight-1', changedPaths: [['counter']] }),
        expect.objectContaining({ itemIndex: 1, itemKey: 'flight-2', changedPaths: [['counter']] }),
      ],
    })
  })

  it('publishes declared Event ports through the host API', async () => {
    const source = `<script setup lang="ts">
const ports = definePorts({ emits: { opened: event<{ id: string }>() } })
</script>
<template><Text>Events</Text></template>`
    const artifact = createSFCArtifact(compileComponentSFC(source))
    const model = RComponentSFC.fromPlain({ id: 1, identity: 'event-host', name: 'Event host', source })
    const host = ComponentSFCRuntimeHost.createRuntime({
      id: 'event-host-runtime',
      model,
      artifactReader: { getArtifact: <TPayload>() => artifact as unknown as ProgramArtifact<TPayload> },
    })
    const received: unknown[] = []
    const dispose = host.onEventPort('opened', occurrence => received.push(occurrence))

    await host.emitEventPort('opened', { id: 'row-1' })
    dispose()
    await host.emitEventPort('opened', { id: 'row-2' })

    expect(received).toEqual([expect.objectContaining({
      componentIdentity: 'event-host',
      event: 'opened',
      payload: { id: 'row-1' },
    })])
    host.destroy()
  })

  it('runs a compiler-linked Query reaction with evaluated Event and lexical input', async () => {
    const source = '<template><Text>Query reaction</Text></template>'
    const artifact = createSFCArtifact(compileComponentSFC(source))
    const model = RComponentSFC.fromPlain({ id: 3, identity: 'query-owner', name: 'Query owner', source })
    const query = new RQuery()
    query.id = 4
    query.identity = 'schedule-sandbox-update-leg'
    query.name = 'Update schedule leg'
    const run = vi.spyOn(Endge.runtime.query, 'run').mockResolvedValue({} as any)
    Endge.domain.addQuery(query)
    const host = ComponentSFCRuntimeHost.createRuntime({
      id: 'query-owner-runtime',
      model,
      artifactReader: { getArtifact: <TPayload>() => artifact as unknown as ProgramArtifact<TPayload> },
    })
    const port: ComponentSFCEventPort = {
      kind: 'event',
      role: 'emits',
      name: 'edited',
      payloadType: 'unknown',
      action: {
        kind: 'query',
        identity: query.identity,
        input: {
          kind: 'object',
          entries: [
            { key: 'id', value: { kind: 'scope', path: 'rowKey' } },
            {
              key: 'payload',
              value: {
                kind: 'object',
                entries: [
                  { key: 'aircraftType', value: { kind: 'event', path: 'value' } },
                  { key: 'updatedAt', value: { kind: 'now' } },
                ],
              },
            },
          ],
        },
      },
    }

    await host.executeEventPortAction(
      model.identity,
      port,
      { value: 'A320', previousValue: 'A319' },
      undefined,
      async () => undefined,
      [],
      0,
      { rowKey: 15 },
    )

    expect(run).toHaveBeenCalledWith(query, {
      id: 15,
      payload: {
        aircraftType: 'A320',
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      },
    }, host)
    host.destroy()
  })

  it('captures inline Operation event and lexical values for undo and default redo', async () => {
    const source = '<template><Text>Inline operation</Text></template>'
    const artifact = createSFCArtifact(compileComponentSFC(source))
    const model = RComponentSFC.fromPlain({ id: 31, identity: 'inline-operation-owner', name: 'Inline operation owner', source })
    const query = new RQuery()
    query.id = 32
    query.identity = 'schedule-sandbox-update-leg'
    query.name = 'Update schedule leg'
    const run = vi.spyOn(Endge.runtime.query, 'run').mockResolvedValue({} as any)
    Endge.domain.addQuery(query)
    const host = ComponentSFCRuntimeHost.createRuntime({
      id: 'inline-operation-runtime',
      model,
      artifactReader: { getArtifact: <TPayload>() => artifact as unknown as ProgramArtifact<TPayload> },
    })
    const history = new OperationHistory({ id: 'inline-history' })
    const resolve = vi.spyOn(Endge.runtime.operations, 'resolveForHost').mockReturnValue(history)
    const port: ComponentSFCEventPort = {
      kind: 'event',
      role: 'emits',
      name: 'edited',
      payloadType: 'unknown',
      action: {
        kind: 'operation',
        run: {
          output: null,
          steps: [{
            name: 'default',
            action: { kind: 'query', identity: query.identity, input: { kind: 'object', entries: [
              { key: 'id', value: { kind: 'scope', path: 'rowKey' } },
              { key: 'value', value: { kind: 'operation-input', path: 'value' } },
            ] } },
          }],
        },
        undo: {
          output: null,
          steps: [{
            name: 'default',
            action: { kind: 'query', identity: query.identity, input: { kind: 'object', entries: [
              { key: 'id', value: { kind: 'scope', path: 'rowKey' } },
              { key: 'value', value: { kind: 'operation-input', path: 'previousValue' } },
            ] } },
          }],
        },
        redo: null,
      },
    }

    await host.executeEventPortAction(model.identity, port, { value: 'SU', previousValue: 'FV' }, undefined, async () => undefined, [], 0, { rowKey: 'leg-1' })
    await history.undo()
    await history.redo()

    expect(run).toHaveBeenNthCalledWith(1, query, { id: 'leg-1', value: 'SU' }, host)
    expect(run).toHaveBeenNthCalledWith(2, query, { id: 'leg-1', value: 'FV' }, host)
    expect(run).toHaveBeenNthCalledWith(3, query, { id: 'leg-1', value: 'SU' }, host)
    resolve.mockRestore()
    history.dispose()
    host.destroy()
  })

  it('owns one edit session and cancels the previous consumer without publishing', () => {
    const source = '<template><Text value="A" editable /></template>'
    const artifact = createSFCArtifact(compileComponentSFC(source))
    const model = RComponentSFC.fromPlain({ id: 2, identity: 'editable-host', name: 'Editable host', source })
    const host = ComponentSFCRuntimeHost.createRuntime({
      id: 'editable-runtime',
      model,
      artifactReader: { getArtifact: <TPayload>() => artifact as unknown as ProgramArtifact<TPayload> },
    })

    host.beginEditSession('row:1/status', 'RUN')
    host.updateEditDraft('row:1/status', 'STOP')
    host.beginEditSession('row:2/status', 'RUN')

    expect(host.getEditSession('row:1/status')).toBeNull()
    expect(host.getEditSession('row:2/status')).toMatchObject({ originalValue: 'RUN', draftValue: 'RUN' })
    host.updateEditDraft('row:2/status', 'DONE')
    expect(host.commitEditSession('row:2/status')).toEqual({ value: 'DONE', previousValue: 'RUN' })
    expect(host.getEditSession('row:2/status')).toBeNull()
    host.destroy()
  })
})

function createSFCArtifact(
  payload: ComponentSFCProgramPayload,
): ProgramArtifact<ComponentSFCProgramPayload> {
  return {
    ref: {
      entityType: 'component-sfc',
      id: 1,
      identity: 'test-sfc-table',
    },
    sourceHash: 'test',
    compilerVersion: 'test',
    status: 'valid',
    diagnostics: [],
    dependencies: [],
    capabilities: ['compilable', 'executable', 'renderable'],
    metadata: { self: {}, nodes: [] },
    payload,
  }
}
