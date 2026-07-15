import { afterEach, describe, expect, it } from 'vitest'

import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { RComputation } from '@/domain/entities/reflect/RComputation'
import { Endge } from '@/model/endge/kernel/endge'

describe('EndgeCompiler ComponentSFC ports', () => {
  afterEach(() => {
    Endge.program.clear()
    Endge.domain.reset()
  })

  it('compiles computations before components and executes the default artifact', () => {
    const computation = new RComputation()
    computation.id = 1
    computation.identity = 'process-state'
    computation.name = 'process-state'
    computation.displayName = 'Process state'
    computation.source = `export default function compute(input: ProcessInput): ProcessOutput {
  return { value: get(input, 'value'), tone: when(isNil(get(input, 'value')), 'muted', 'success') }
}`

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
    expect(Endge.runtime.computation.run('process-state', { value: '07:15' })).toEqual({
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
