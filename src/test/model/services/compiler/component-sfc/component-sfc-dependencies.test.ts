import { describe, expect, it } from 'vitest'

import { analyzeComponentSFCRuntimeDependencies } from '@/model/services/compiler/component-sfc/component-sfc-dependencies'
import { compileComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-compile'

describe('analyzeComponentSFCRuntimeDependencies', () => {
  it('finds prop reads from interpolation, dynamic attrs and if directives', () => {
    const ir = compileComponentSFC(`<script setup lang="ts">
defineProps<{
  flight: FlightLeg
  compact?: boolean
}>()
</script>

<template>
<Flex col if="!compact">
  <Badge :tone="flight.statusTone">{{ flight.number }}</Badge>
</Flex>
</template>`).ir

    const deps = analyzeComponentSFCRuntimeDependencies(ir)

    expect(deps.props.map(dep => `${dep.prop}.${dep.path.join('.')}`)).toEqual([
      'compact.',
      'flight.statusTone',
      'flight.number',
    ])
  })

  it('deduplicates same reads and ignores literals', () => {
    const ir = compileComponentSFC(`<script setup lang="ts">
defineProps<{
  flight: FlightLeg
}>()
</script>

<template>
<Flex gap="2">
  <Text>{{ flight.number }}</Text>
  <Badge tone="success">{{ flight.number }}</Badge>
</Flex>
</template>`).ir

    const deps = analyzeComponentSFCRuntimeDependencies(ir)

    expect(deps.props).toHaveLength(1)
    expect(deps.props[0]).toMatchObject({
      prop: 'flight',
      path: ['number'],
    })
  })

  it('collects for source dependency without analyzing arbitrary script body', () => {
    const ir = compileComponentSFC(`<script setup lang="ts">
const localValue = flight.hidden
defineProps<{
  flights: FlightLeg[]
}>()
</script>

<template>
<Flex>
  <Text for="flight in flights">{{ flight.number }}</Text>
</Flex>
</template>`).ir

    const deps = analyzeComponentSFCRuntimeDependencies(ir)

    expect(deps.props).toEqual([
      expect.objectContaining({
        prop: 'flights',
        path: [],
      }),
    ])
  })

  it('collects table rows dependency and ignores row scoped reads', () => {
    const ir = compileComponentSFC(`<script setup lang="ts">
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
</template>`).ir

    const deps = analyzeComponentSFCRuntimeDependencies(ir)

    expect(deps.props).toEqual([
      expect.objectContaining({
        prop: 'flights',
        path: [],
      }),
    ])
    expect(deps.boundaries).toEqual([
      expect.objectContaining({
        kind: 'table',
        sourceProp: 'flights',
        sourcePath: [],
        rowKey: 'id',
        columns: [
          expect.objectContaining({
            key: 'number',
            index: 0,
            rowReads: ['number', 'counter'],
          }),
        ],
      }),
    ])
  })

  it('collects prop reads from display-only input primitives', () => {
    const ir = compileComponentSFC(`<script setup lang="ts">
defineProps<{
  search: string
  cancelled: boolean
  status: string
  statusOptions: Array<{ value: string, label?: string }>
}>()
</script>

<template>
  <Input :value="search" />
  <Textarea :value="search" />
  <Checkbox :checked="cancelled" />
  <Select :value="status" :options="statusOptions" />
</template>`).ir

    const deps = analyzeComponentSFCRuntimeDependencies(ir)

    expect(deps.props.map(dep => `${dep.prop}.${dep.path.join('.')}`)).toEqual([
      'search.',
      'cancelled.',
      'status.',
      'statusOptions.',
    ])
  })

  it('ignores unsupported or global identifiers', () => {
    const ir = compileComponentSFC(`<script setup lang="ts">
defineProps<{
  flight: FlightLeg
}>()
</script>

<template>
<Text>{{ Math.max(1, 2) }}</Text>
</template>`).ir

    const deps = analyzeComponentSFCRuntimeDependencies(ir)

    expect(deps.props).toEqual([])
  })
})
