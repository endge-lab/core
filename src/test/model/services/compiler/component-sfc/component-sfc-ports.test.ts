import { describe, expect, it } from 'vitest'

import { compileComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-compile'

const SOURCE = `<script setup lang="ts">
interface Props {
  process?: GroundHandlingOperation
}

interface ProcessStateInput {
  process?: GroundHandlingOperation
}

interface ProcessState {
  target?: GroundHandlingPointState
}

interface CellProps {
  point?: GroundHandlingPointState
}

const props = defineProps<Props>()

const ports = definePorts({
  state: computation<ProcessStateInput, ProcessState>({
    default: 'groundhandling-process-state',
  }),
  cell: component<CellProps>({
    tag: 'GroundHandling.Cell',
    default: 'groundhandling-process-cell',
  }),
})

const state = ports.state({ process: props.process })
</script>

<template>
  <GroundHandling.Cell :point="state.target" />
</template>`

describe('ComponentSFC ports compiler', () => {
  it('compiles both port kinds, a computation local and a dotted local tag', () => {
    const result = compileComponentSFC(SOURCE, {
      resolveComponentTag: () => 'global-component-that-must-not-win',
      resolvePortProvider: (identity) => identity === 'groundhandling-process-state'
        ? {
            kind: 'computation',
            identity,
            active: true,
            input: { type: 'ProcessStateInput' },
            output: { type: 'ProcessState' },
          }
        : {
            kind: 'component',
            identity,
            active: true,
            inputs: [{ name: 'point', type: 'GroundHandlingPointState', optional: true, isArray: false }],
          },
    })

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(result.contract.inputs).toEqual([
      expect.objectContaining({ name: 'process', type: 'GroundHandlingOperation', optional: true }),
    ])
    expect(result.ir?.script.ports).toMatchObject({
      computations: [{ name: 'state', defaultIdentity: 'groundhandling-process-state' }],
      components: [{ name: 'cell', tag: 'GroundHandling.Cell', defaultIdentity: 'groundhandling-process-cell' }],
    })
    expect(result.ir?.script.portCalls).toMatchObject([
      {
        local: 'state',
        port: 'state',
        defaultIdentity: 'groundhandling-process-state',
        input: { kind: 'expression', source: '{ process: props.process }' },
      },
    ])
    expect(result.ir?.template.roots[0]).toMatchObject({
      kind: 'element',
      tag: 'Component',
      props: { is: { kind: 'literal', value: 'groundhandling-process-cell' } },
      port: { kind: 'component', port: 'cell', defaultIdentity: 'groundhandling-process-cell' },
    })
    expect(result.dependencies).toMatchObject({
      computations: [{ id: 'groundhandling-process-state', role: 'port-default-computation' }],
      components: [{ id: 'groundhandling-process-cell', role: 'port-default-component' }],
    })
    expect(result.runtimeDependencies.props).toEqual([
      expect.objectContaining({ prop: 'process', path: [] }),
    ])
  })

  it('reports missing defaults, reserved tags and wrong provider kinds', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
interface Input { value?: string }
interface Output { tone?: string }
interface Props { value?: string }
const ports = definePorts({
  state: computation<Input, Output>({}),
  cell: component<Props>({ tag: 'Text', default: 'wrong-kind' }),
  other: component<Props>({ tag: 'GroundHandling.Other', default: 'wrong-kind' }),
})
</script>
<template><Text /></template>`, {
      resolvePortProvider: () => ({
        kind: 'computation',
        identity: 'wrong-kind',
        active: true,
        input: { type: 'Input' },
        output: { type: 'Output' },
      }),
    })

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-port-default-required' }),
      expect.objectContaining({ code: 'sfc-component-port-tag-reserved' }),
      expect.objectContaining({ code: 'sfc-port-default-kind' }),
    ]))
  })

  it('reports an unknown port call with a source range', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
const ports = definePorts({})
const state = ports.unknown({})
</script>
<template><Text>{{ state }}</Text></template>`)

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'sfc-port-call-unknown',
        severity: 'error',
        start: expect.any(Number),
        end: expect.any(Number),
      }),
    ]))
  })

  it('rejects nested definePorts and non-top-level computation calls', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
interface Input { value?: string }
interface Output { value?: string }
const ports = definePorts({
  state: computation<Input, Output>({ default: 'state' }),
})
function invalid() {
  definePorts({})
  return ports.state({ value: 'nested' })
}
</script>
<template><Text>invalid</Text></template>`)

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-ports-top-level-required', start: expect.any(Number), end: expect.any(Number) }),
      expect.objectContaining({ code: 'sfc-port-call-top-level-const', start: expect.any(Number), end: expect.any(Number) }),
    ]))
  })

  it('validates missing and inactive providers without requiring a computation contract', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
interface Input { value?: string }
interface Output { tone?: string }
interface Props { value?: string }
const ports = definePorts({
  missing: computation<Input, Output>({ default: 'missing' }),
  state: computation<Input, Output>({ default: 'wrong-contract' }),
  cell: component<Props>({ tag: 'Local.Cell', default: 'inactive-cell' }),
})
</script>
<template><Local.Cell /></template>`, {
      resolvePortProvider: (identity) => {
        if (identity === 'missing') return null
        if (identity === 'wrong-contract') {
          return {
            kind: 'computation',
            identity,
            active: true,
            input: { type: 'OtherInput' },
            output: { type: 'OtherOutput' },
          }
        }
        return {
          kind: 'component',
          identity,
          active: false,
          inputs: [{ name: 'required', type: 'string', optional: false }],
        }
      },
    })

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-port-default-missing' }),
      expect.objectContaining({ code: 'sfc-port-default-inactive' }),
      expect.objectContaining({ code: 'sfc-component-port-contract' }),
    ]))
    expect(result.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-computation-port-contract' }),
    ]))
  })
})
