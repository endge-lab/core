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
  require: {
    state: computation<ProcessStateInput, ProcessState>({
      default: 'groundhandling-process-state',
    }),
    cell: component<CellProps>({
      tag: 'GroundHandling.Cell',
      default: 'groundhandling-process-cell',
    }),
  },
})

const state = ports.require.state({ process: props.process })
</script>

<template>
  <GroundHandling.Cell :point="state.target" />
</template>`

describe('ComponentSFC ports compiler', () => {
  it('forwards all intrinsic public Table Actions with forward wildcard', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
const ports = definePorts({
  forward: '*',
})
</script>
<template><Table ref="departures" :rows="[]" /></template>`)

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(result.ir?.script.ports.provides.actions).toHaveLength(9)
    expect(result.ir?.script.ports.provides.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'table.column.pinLeft',
        forwardedFrom: expect.objectContaining({ ref: 'departures', componentTag: 'Table' }),
      }),
      expect.objectContaining({ name: 'table.sort.clearAll' }),
    ]))
  })

  it('forwards different port selections from different component refs', () => {
    const first = compileComponentSFC(`<script setup lang="ts">
const ports = definePorts({
  provides: {
    'first.keep': action<unknown, void>(),
    'first.skip': action<unknown, void>(),
  },
  emits: {
    firstChanged: event<{ id: string }>(),
  },
})
</script>
<template><Text>First</Text></template>`).ir!.script.ports
    const second = compileComponentSFC(`<script setup lang="ts">
const ports = definePorts({
  provides: {
    'second.keep': action<unknown, void>(),
    'second.skip': action<unknown, void>(),
  },
  emits: {
    secondChanged: event<void>(),
  },
})
</script>
<template><Text>Second</Text></template>`).ir!.script.ports

    const result = compileComponentSFC(`<script setup lang="ts">
const ports = definePorts({
  forward: [
    {
      from: 'first',
      ports: {
        provides: ['first.keep'],
        emits: ['firstChanged'],
      },
    },
    {
      from: 'second',
      ports: {
        provides: ['second.keep'],
      },
    },
  ],
})
</script>
<template>
  <First.Child ref="first" />
  <Second.Child ref="second" />
</template>`, {
      resolveComponentTag: tag => ({
        'First.Child': 'first-child',
        'Second.Child': 'second-child',
      })[tag] ?? null,
      resolveComponentPortManifest: identity => ({
        'first-child': first,
        'second-child': second,
      })[identity] ?? null,
    })

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(result.ir?.script.ports.provides.actions.map(port => port.name)).toEqual([
      'first.keep',
      'second.keep',
    ])
    expect(result.ir?.script.ports.emits.events.map(port => port.name)).toEqual(['firstChanged'])
    expect(result.contract.events).toEqual([{ name: 'firstChanged', payloadType: '{ id: string }' }])
  })

  it('reports forward collisions and unmatched selectors as build diagnostics', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
const ports = definePorts({
  forward: [
    { from: 'departures', ports: { provides: '*' } },
    { from: 'arrivals', ports: { provides: ['table.column.pinLeft', 'table.unknown'] } },
  ],
})
</script>
<template>
  <Table ref="departures" :rows="[]" />
  <Table ref="arrivals" :rows="[]" />
</template>`)

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-port-forward-collision', severity: 'error' }),
      expect.objectContaining({ code: 'sfc-port-forward-selection-empty', severity: 'warning' }),
    ]))
  })

  it('rejects the removed request section with a targeted migration diagnostic', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
const ports = definePorts({
  request: {
    open: action<unknown, void>({ default: 'open' }),
  },
})
</script>
<template><Text>Invalid</Text></template>`)

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-port-request-renamed', severity: 'error' }),
    ]))
  })

  it('compiles required and provided Actions plus emitted Events into one manifest', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
interface OpenInput { id: string }
interface RowActivated { id: string }
const ports = definePorts({
  require: {
    openDetails: action<OpenInput, void>({ default: 'flight.open-details' }),
  },
  provides: {
    'table.sort.clearAll': action<unknown, void>(),
  },
  emits: {
    rowActivated: event<RowActivated>(),
  },
})
</script>
<template><Text>Flights</Text></template>`, {
      resolvePortProvider: identity => ({
        kind: 'action',
        identity,
        active: true,
        input: { type: 'OpenInput' },
        output: null,
      }),
    })

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(result.ir?.script.ports).toMatchObject({
      require: { actions: [{ name: 'openDetails', defaultIdentity: 'flight.open-details' }] },
      provides: { actions: [{ name: 'table.sort.clearAll' }] },
      emits: { events: [{ name: 'rowActivated', payloadType: 'RowActivated' }] },
    })
    expect(result.contract.events).toEqual([{ name: 'rowActivated', payloadType: 'RowActivated' }])
    expect(result.dependencies.actions).toContain('flight.open-details')
  })

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
      require: {
        computations: [{ name: 'state', defaultIdentity: 'groundhandling-process-state' }],
        components: [{ name: 'cell', tag: 'GroundHandling.Cell', defaultIdentity: 'groundhandling-process-cell' }],
      },
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
  require: {
    state: computation<Input, Output>({}),
    cell: component<Props>({ tag: 'Text', default: 'wrong-kind' }),
    other: component<Props>({ tag: 'GroundHandling.Other', default: 'wrong-kind' }),
  },
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
const state = ports.require.unknown({})
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
  require: {
    state: computation<Input, Output>({ default: 'state' }),
  },
})
function invalid() {
  definePorts({})
  return ports.require.state({ value: 'nested' })
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
  require: {
    missing: computation<Input, Output>({ default: 'missing' }),
    state: computation<Input, Output>({ default: 'wrong-contract' }),
    cell: component<Props>({ tag: 'Local.Cell', default: 'inactive-cell' }),
  },
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
            input: null,
            output: null,
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
