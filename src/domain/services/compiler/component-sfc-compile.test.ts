import { describe, expect, it } from 'vitest'

import { compileComponentSFC } from '@/domain/services/compiler/component-sfc-compile'

describe('compileComponentSFC', () => {
  it('extracts preview props without changing the component contract', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
defineProps<{
  status: string
  tone: string
}>()

definePreviewProps({
  status: 'Delayed',
  tone: 'warning',
})
</script>

<template>
  <Badge :tone="tone">{{ status }}</Badge>
</template>
`)

    expect(result.previewProps).toEqual({
      status: 'Delayed',
      tone: 'warning',
    })
    expect(result.contract.inputs).toEqual([
      {
        name: 'status',
        type: 'string',
        isArray: false,
        optional: false,
      },
      {
        name: 'tone',
        type: 'string',
        isArray: false,
        optional: false,
      },
    ])
  })

  it('unwraps a full SFC accidentally stored inside the template block', () => {
    const result = compileComponentSFC(`<template>
<script setup lang="ts">
defineProps<{
  status: string
  tone: string
}>()
</script>

<template>
  <Flex row gap="2" align="center">
    <Dot :tone="tone" />
    <Badge :tone="tone">{{ status }}</Badge>
  </Flex>
</template>

<style lang="endgecss" scoped>
</style>
</template>
`)

    expect(result.diagnostics.filter(item => item.code === 'sfc-template-tag-unsupported')).toEqual([])
    expect(result.contract.inputs.map(item => item.name)).toEqual(['status', 'tone'])
    expect(result.ir?.template.roots[0]?.kind).toBe('element')
  })

  it('unwraps a full SFC stored inside a default SFC wrapper template', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
const props = defineProps<Record<string, unknown>>()
</script>

<template>
<script setup lang="ts">
defineProps<{
  flight: FlightLeg
  compact?: boolean
}>()
</script>

<template>
<Flex col gap="2" p="4">
  <Text>{{ flight.number }}</Text>
</Flex>
</template>

<style lang="endgecss" scoped>
</style>
</template>
`)

    expect(result.diagnostics.filter(item => item.code === 'sfc-template-tag-unsupported')).toEqual([])
    expect(result.contract.inputs.map(item => item.name)).toEqual(['flight', 'compact'])
    expect(result.ir?.template.roots[0]?.kind).toBe('element')
  })

  it('accepts table structural primitives', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
defineProps<{
  flights: FlightLeg[]
}>()
</script>

<template>
<Table :rows="flights" row-key="id">
  <Column key="number" title="Flight">
    <Cell>
      <Text>{{ row.number }}</Text>
    </Cell>
  </Column>
</Table>
</template>
`)

    expect(result.diagnostics.filter(item => item.code === 'sfc-template-tag-unsupported')).toEqual([])
    expect(result.ir?.template.roots[0]).toMatchObject({
      kind: 'element',
      tag: 'Table',
    })
  })

  it('extracts entity and node metadata without leaking compiler attributes into IR props', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
defineProps<{
  flights: FlightLeg[]
}>()

defineMetadata({
  'hub.tgo': {
    entity: 'flight',
  },
})
</script>

<template>
  <Table :rows="flights">
    <Column
      key="bestOn"
      :metadata="{ 'hub.tgo': { attributes: ['BestOn'], order: 1 } }"
    />
  </Table>
</template>
`)

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(result.metadata).toEqual({
      self: {
        'hub.tgo': { entity: 'flight' },
      },
      nodes: [{
        nodeId: 'root-0-0',
        nodeKind: 'Column',
        key: 'bestOn',
        values: {
          'hub.tgo': { attributes: ['BestOn'], order: 1 },
        },
      }],
    })

    const table = result.ir?.template.roots[0]
    const column = table?.kind === 'element' ? table.children[0] : null
    expect(column?.kind === 'element' ? column.props.metadata : undefined).toBeUndefined()
  })

  it('rejects runtime-dependent node metadata', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
const columnMetadata = { 'hub.tgo': { attributes: ['BestOn'] } }
</script>

<template>
  <Column key="bestOn" :metadata="columnMetadata" />
</template>
`)

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'program-metadata-shape', severity: 'error' }),
    ]))
    expect(result.metadata.nodes).toEqual([])
  })

  it('accepts display-only input primitives and preserves their props in IR', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
defineProps<{
  search: string
  cancelled: boolean
  status: string
  airlines: string[]
  statusOptions: Array<{ value: string, label?: string }>
}>()
</script>

<template>
  <Input type="String" :value="search" placeholder="Поиск" />
  <Textarea :value="search" rows="4" />
  <Checkbox :checked="cancelled" label="Отменённые" />
  <Select multiple :value="airlines" :options="statusOptions" />
</template>
`)

    expect(result.diagnostics.filter(item => item.code === 'sfc-template-tag-unsupported')).toEqual([])
    expect(result.ir?.template.roots).toMatchObject([
      {
        kind: 'element',
        tag: 'Input',
        props: {
          type: { kind: 'literal', value: 'String' },
          value: { kind: 'expression', source: 'search' },
          placeholder: { kind: 'literal', value: 'Поиск' },
        },
      },
      {
        kind: 'element',
        tag: 'Textarea',
        props: {
          value: { kind: 'expression', source: 'search' },
          rows: { kind: 'literal', value: '4' },
        },
      },
      {
        kind: 'element',
        tag: 'Checkbox',
        props: {
          checked: { kind: 'expression', source: 'cancelled' },
          label: { kind: 'literal', value: 'Отменённые' },
        },
      },
      {
        kind: 'element',
        tag: 'Select',
        props: {
          multiple: { kind: 'literal', value: true },
          value: { kind: 'expression', source: 'airlines' },
          options: { kind: 'expression', source: 'statusOptions' },
        },
      },
    ])
  })
})
