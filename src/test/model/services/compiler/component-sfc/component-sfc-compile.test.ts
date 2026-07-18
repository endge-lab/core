import { describe, expect, it } from 'vitest'

import { compileComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-compile'
import { isComponentSFCBuiltInTag } from '@/model/services/compiler/component-sfc/component-sfc-template'

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

  it('accepts Grid containers and preserves child placement props', () => {
    const result = compileComponentSFC(`<template>
<Grid columns="12" gap="2" autoRows="28px">
  <Text colStart="1" colSpan="5" rowStart="1" rowSpan="2">Primary</Text>
  <Text colStart="1" colSpan="12" rowStart="3">Secondary</Text>
</Grid>
</template>
`)

    expect(result.diagnostics.filter(item => item.code === 'sfc-template-tag-unsupported')).toEqual([])
    expect(result.ir?.template.roots[0]).toMatchObject({
      kind: 'element',
      tag: 'Grid',
      props: {
        columns: { kind: 'literal', value: '12' },
        gap: { kind: 'literal', value: '2' },
        autoRows: { kind: 'literal', value: '28px' },
      },
    })
    const grid = result.ir?.template.roots[0]
    const firstChild = grid?.kind === 'element' ? grid.children[0] : null
    expect(firstChild).toMatchObject({
      kind: 'element',
      tag: 'Text',
      props: {
        colStart: { kind: 'literal', value: '1' },
        colSpan: { kind: 'literal', value: '5' },
        rowStart: { kind: 'literal', value: '1' },
        rowSpan: { kind: 'literal', value: '2' },
      },
    })
    expect(isComponentSFCBuiltInTag('Grid')).toBe(true)
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

  it('normalizes direct user tags and Component is into one component-call IR', () => {
    const identities = new Set(['aircraft-tail', 'aircraft-type'])
    const result = compileComponentSFC(`<script setup lang="ts">
defineProps<{
  aircraft: Aircraft
  visible: boolean
  items: Aircraft[]
}>()
</script>

<template>
  <Tail if="visible" :aircraft="aircraft" />
  <Module.SomeTag else :aircraft="aircraft" />
  <Component is="aircraft-tail" for="item in items" :aircraft="item" />
</template>
`, {
      resolveComponentTag: tag => ({
        Tail: 'aircraft-tail',
        'Module.SomeTag': 'aircraft-type',
      })[tag] ?? null,
      hasComponentIdentity: identity => identities.has(identity),
    })

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(result.ir?.template.roots).toMatchObject([
      {
        kind: 'element',
        tag: 'Component',
        props: {
          is: { kind: 'literal', value: 'aircraft-tail' },
          aircraft: { kind: 'expression', source: 'aircraft' },
        },
        directives: { if: { kind: 'expression', source: 'visible' } },
      },
      {
        kind: 'element',
        tag: 'Component',
        props: {
          is: { kind: 'literal', value: 'aircraft-type' },
        },
        directives: { else: true },
      },
      {
        kind: 'element',
        tag: 'Component',
        props: {
          is: { kind: 'literal', value: 'aircraft-tail' },
          aircraft: { kind: 'expression', source: 'item' },
        },
        directives: {
          for: {
            item: 'item',
            source: { kind: 'expression', source: 'items' },
          },
        },
      },
    ])
    expect(result.dependencies.components).toEqual([
      { source: 'component-sfc', id: 'aircraft-tail' },
      { source: 'component-sfc', id: 'aircraft-type' },
      { source: 'component-sfc', id: 'aircraft-tail' },
    ])
  })

  it('reports unknown direct tags and missing static Component identities', () => {
    const result = compileComponentSFC(`<template>
  <Unknown.Tag />
  <Component is="missing-component" />
</template>`, {
      resolveComponentTag: () => null,
      hasComponentIdentity: () => false,
    })

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-template-component-tag-unknown' }),
      expect.objectContaining({ code: 'sfc-template-component-missing' }),
    ]))
  })
})
