import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
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
  state: computation<ProcessInput, ProcessOutput>({ default: 'process-state' }),
  cell: component<CellProps>({ tag: 'Process.Cell', default: 'process-cell' }),
})
const state = ports.state({ value: props.value })
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
