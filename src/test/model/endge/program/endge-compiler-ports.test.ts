import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { RAction } from '@/domain/entities/reflect/RAction'
import { RComputation } from '@/domain/entities/reflect/RComputation'
import { REnvironment } from '@/domain/entities/reflect/REnvironment'
import { RProject } from '@/domain/entities/reflect/RProject'
import { RTenant } from '@/domain/entities/reflect/RTenant'
import { Endge } from '@/model/endge/kernel/endge'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('EndgeCompiler ComponentSFC ports', () => {
  beforeEach(() => prepareCompilerContext())

  afterEach(() => {
    Endge.configuration.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Endge.workspace.reset()
  })

  it('compiles computations before components and executes the default artifact', async () => {
    const computation = new RComputation()
    computation.id = 1
    computation.identity = 'process-state'
    computation.name = 'process-state'
    computation.displayName = 'Process state'
    computation.source = `defineComputation({
  outputs: {
    state: { value: input('value'), tone: when(isNil(input('value')), 'muted', 'success') },
  },
  result: output('state'),
})`

    const cell = component(2, 'process-cell', `<script setup lang="ts">
interface CellProps { point?: ProcessOutput }
defineProps<CellProps>()
</script>
<template><Text>{{ point?.value }}</Text></template>`)
    const owner = component(3, 'process-owner', `<script setup lang="ts">
interface Props { value?: string }
interface ProcessInput { value?: string }
interface ProcessOutput { value?: string, tone?: string }
interface CellProps { point?: ProcessOutput }
const props = defineProps<Props>()
const ports = definePorts({
  require: {
    state: computation<ProcessInput, ProcessOutput>({ default: 'process-state' }),
    cell: component<CellProps>({ tag: 'Process.Cell', default: 'process-cell' }),
  },
})
const state = ports.require.state({ value: props.value })
</script>
<template><Process.Cell :point="state" /></template>`)

    Endge.domain.addComputation(computation)
    Endge.domain.addComponentSFC(cell)
    Endge.domain.addComponentSFC(owner)
    Endge.compiler.build({} as any)

    expect(Endge.program.getComputationArtifact('process-state')?.status).toBe('valid')
    const ownerArtifact = Endge.program.getArtifact('component-sfc', 'process-owner')
    expect(ownerArtifact?.status).toBe('valid')
    expect(ownerArtifact?.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'computation', role: 'port-default-computation' }),
      expect.objectContaining({ entityType: 'component-sfc', role: 'port-default-component' }),
    ]))
    await expect(Endge.runtime.computation.run('process-state', { value: '07:15' })).resolves.toEqual({
      value: '07:15',
      tone: 'success',
    })
  })

  it('records required Action defaults as program dependencies', () => {
    const openDetails = new RAction()
    openDetails.id = 7
    openDetails.identity = 'flight.open-details'
    openDetails.name = 'Open details'
    Endge.domain.addAction(openDetails)
    Endge.domain.addComponentSFC(component(8, 'flight-table', `<script setup lang="ts">
const ports = definePorts({
  require: {
    openDetails: action<{ id: string }, void>({ default: 'flight.open-details' }),
  },
})
</script>
<template><Text>Flights</Text></template>`))

    Endge.compiler.build({} as any)

    expect(Endge.program.getArtifact('component-sfc', 'flight-table')?.dependencies).toContainEqual({
      entityType: 'action',
      id: 'flight.open-details',
      identity: 'flight.open-details',
      role: 'port-default-action',
    })
  })

  it('publishes forward collisions to the build diagnostics system', () => {
    Endge.domain.addComponentSFC(component(9, 'table-collision', `<script setup lang="ts">
const ports = definePorts({
  forward: '*',
})
</script>
<template>
  <Table ref="departures" :rows="[]" />
  <Table ref="arrivals" :rows="[]" />
</template>`))

    Endge.compiler.build({} as any)

    expect(Endge.program.getArtifact('component-sfc', 'table-collision')?.status).toBe('error')
    expect(Endge.diagnostics.problems.query({ entityIdentity: 'table-collision' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-port-forward-collision', severity: 'error' }),
    ]))
  })

  it('resolves forwarded child manifests independently from component compile order', () => {
    const parent = component(10, 'parent-public', `<script setup lang="ts">
const ports = definePorts({
  forward: '*',
})
</script>
<template><Component ref="child" is="child-public" /></template>`)
    const child = component(11, 'child-public', `<script setup lang="ts">
const ports = definePorts({
  provides: {
    refresh: action<void, void>(),
  },
  emits: {
    changed: event<{ id: string }>(),
  },
})
</script>
<template><Text>Child</Text></template>`)
    Endge.domain.addComponentSFC(parent)
    Endge.domain.addComponentSFC(child)

    Endge.compiler.build({} as any)

    const parentArtifact = Endge.program.getArtifact('component-sfc', 'parent-public')
    expect(parentArtifact?.status).toBe('valid')
    expect(parentArtifact?.payload.ir?.script.ports).toMatchObject({
      provides: { actions: [{ name: 'refresh', forwardedFrom: { ref: 'child' } }] },
      emits: { events: [{ name: 'changed', forwardedFrom: { ref: 'child' } }] },
    })
    expect(Endge.domain.resolved.get<RAction>('action', 'parent-public.refresh')).toMatchObject({
      origin: { kind: 'derived', source: { type: 'component-sfc', identity: 'parent-public' } },
      target: [{ type: 'component-sfc', identity: 'parent-public' }],
      defaultImplementation: { kind: 'component-port', portName: 'refresh' },
    })
  })

  it('routes a derived component-port Action to the concrete runtime target', async () => {
    Endge.domain.addComponentSFC(component(12, 'action-owner', `<script setup lang="ts">
const ports = definePorts({ provides: { refresh: action<{ force: boolean }, void>() } })
</script>
<template><Text>Owner</Text></template>`))
    Endge.compiler.build({} as any)
    const invokeAction = vi.fn()

    await Endge.actions.execute('action-owner.refresh', {
      input: { force: true },
      target: { type: 'component-sfc', identity: 'action-owner', value: { invokeAction } },
    })

    expect(invokeAction).toHaveBeenCalledWith('refresh', { force: true })
  })
})

function component(id: number, identity: string, source: string): RComponentSFC {
  const model = new RComponentSFC()
  model.id = id
  model.identity = identity
  model.name = identity
  model.displayName = identity
  model.source = source
  return model
}

function prepareCompilerContext(): void {
  Endge.domain.reset()
  Endge.workspace.apply(TEST_ENDGE_WORKSPACE)
  Endge.domain.addProject(RProject.fromPlain({ id: 101, identity: 'project', name: 'Project' }))
  Endge.domain.addEnvironment(REnvironment.fromPlain({ id: 102, identity: 'environment', name: 'Environment' }))
  const tenant = new RTenant()
  tenant.id = 103
  tenant.identity = 'tenant'
  tenant.name = 'Tenant'
  tenant.code = 'tenant'
  Endge.domain.addTenant(tenant)
  Endge.configuration.build({
    dataProvider: 'plain',
    scope: {},
    vars: {},
    context: { projectIdentity: 'project', environmentIdentity: 'environment', tenantIdentity: 'tenant' },
  })
}
