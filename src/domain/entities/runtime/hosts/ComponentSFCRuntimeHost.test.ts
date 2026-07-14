import { afterEach, describe, expect, it } from 'vitest'
import { Raph } from '@endge/raph'

import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { ComponentSFCRuntimeHost } from '@/domain/entities/runtime/hosts/ComponentSFCRuntimeHost'
import { compileComponentSFC } from '@/model/services/compiler/component-sfc-compile'
import type { ComponentSFCProgramPayload, ProgramArtifact } from '@/domain/types/program.types'
import type {
  RuntimeBoundaryPatch,
  RuntimeHostUpdateContext,
} from '@/domain/types/runtime-host.types'
import { RuntimeBoundaryUpdatePhase } from '@/model/helpers/raph-phases/runtime-boundary-update-phase'

describe('ComponentSFCRuntimeHost', () => {
  afterEach(() => {
    Raph.app.reset()
    Raph.clearPhases()
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
    const reader = {
      getArtifact: () => artifact,
    }
    const patches: RuntimeBoundaryPatch[] = []
    const propsUpdates: RuntimeHostUpdateContext[] = []
    let host: ComponentSFCRuntimeHost | null = null

    Raph.app.reset()
    Raph.definePhases([
      RuntimeBoundaryUpdatePhase.make({
        resolveHost: runtimeId => runtimeId === 'runtime-1' ? host : null,
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
