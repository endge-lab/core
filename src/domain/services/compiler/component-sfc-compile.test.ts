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
})
