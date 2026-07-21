import { afterEach, describe, expect, it } from 'vitest'
import { Raph } from '@endge/raph'

import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { ComponentSFCRuntimeHost } from '@/domain/entities/runtime/hosts/ComponentSFCRuntimeHost'
import { compileComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-compile'
import type { ComponentSFCProgramPayload, ProgramArtifact } from '@/domain/types/program/program.types'
import type {
  RuntimeBoundaryPatch,
  RuntimeArtifactReader,
  RuntimeHostUpdateContext,
} from '@/domain/types/runtime/runtime-host.types'
import { RuntimeBoundaryUpdatePhase } from '@/model/helpers/raph-phases/runtime-boundary-update-phase'
import { Endge } from '@/model/endge/kernel/endge'

describe('ComponentSFCRuntimeHost', () => {
  afterEach(() => {
    Endge.styles.reset()
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
      id: 'styled-1', model, meta: { runtimeScopeId: 'scope:test' }, artifactReader: reader,
    })
    const second = ComponentSFCRuntimeHost.createRuntime({
      id: 'styled-2', model, meta: { runtimeScopeId: 'scope:test' }, artifactReader: reader,
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
