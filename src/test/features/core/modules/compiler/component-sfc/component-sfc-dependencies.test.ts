import { describe, expect, it } from 'vitest'

import { compileComponentSFC } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-compile'
import { analyzeComponentSFCRuntimeDependencies } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-dependencies'
import { resolveComponentSFCExpressionCompletions } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-expression'

describe('анализ runtime-зависимостей Component SFC', () => {
  it('находит чтения props из интерполяций, динамических атрибутов и директив if', () => {
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

  it('дедублицирует одинаковые чтения и игнорирует литералы', () => {
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

  it('собирает зависимость source для for без анализа произвольного тела script', () => {
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

  it('собирает зависимость строк таблицы и игнорирует чтения в scope строки', () => {
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

  it('собирает чтения props из input-примитивов только для отображения', () => {
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

  it('игнорирует неподдерживаемые и глобальные идентификаторы', () => {
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

  it('компилирует `$data.metaOf` как отдельную Meta dependency', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
defineProps<{ flights: FlightLeg[] }>()
</script>
<template>
  <Table :rows="flights" row-key="id">
    <Column key="flightCarrier">
      <Cell>
        <Text>{{ $data.metaOf(row.flightCarrier, 'aodb.optimistic')?.status }}</Text>
      </Cell>
    </Column>
  </Table>
</template>`)

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(result.runtimeDependencies.meta).toEqual([
      expect.objectContaining({
        boundaryId: result.runtimeDependencies.boundaries[0]?.id,
        namespace: 'aodb.optimistic',
        reference: { kind: 'table-row', path: ['flightCarrier'] },
      }),
    ])
  })

  it('отклоняет динамическую ссылку и namespace в `$data.metaOf`', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
defineProps<{ flight: FlightLeg; namespace: string }>()
</script>
<template><Text>{{ $data.metaOf(getFlight(), namespace) }}</Text></template>`)

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-data-meta-call-shape', severity: 'error' }),
    ]))
  })

  it('предлагает `$data.metaOf` в expression completion', () => {
    expect(resolveComponentSFCExpressionCompletions({
      source: '$data.',
      cursor: '$data.'.length,
      scope: 'table-row-menu',
    })).toEqual([
      expect.objectContaining({ label: 'metaOf', kind: 'property' }),
    ])
  })
})
