import { describe, expect, it } from 'vitest'

import { inspectComponentSFCVisual } from '@/model/services/source-engine/component-sfc/component-sfc-visual-projection'

describe('Component SFC visual projection', () => {
  it('enables table visualization for one root Table and projects its columns', () => {
    const result = inspectComponentSFCVisual(`<script setup lang="ts">
defineProps<{ rows: unknown[] }>()
</script>

<template>
  <!-- table comment stays source-owned -->
  <Table :rows="rows" row-key="id" sort-mode="single" default-pin="number:left">
    <Column key="number" title="Flight" width="180" sortable sort-by="carrier, number">
      <Cell>
        <Text>{{ row.number }}</Text>
      </Cell>
    </Column>
    <Column key="status" title="Status" pinnable="false" />
  </Table>
</template>
`)

    expect(result.support).toEqual({ kind: 'table' })
    expect(result.projection).toMatchObject({
      kind: 'table',
      rows: { kind: 'expression', source: 'rows' },
      rowKey: { kind: 'literal', value: 'id' },
      sortMode: { kind: 'literal', value: 'single' },
      defaultPin: { kind: 'literal', value: 'number:left' },
      columns: [
        {
          key: { kind: 'literal', value: 'number' },
          title: { kind: 'literal', value: 'Flight' },
          width: { kind: 'literal', value: '180' },
          sortable: { kind: 'boolean', value: true },
          sortBy: { kind: 'literal', value: 'carrier, number' },
          cell: { kind: 'source' },
          hasCustomCell: true,
        },
        {
          key: { kind: 'literal', value: 'status' },
          title: { kind: 'literal', value: 'Status' },
          pinnable: { kind: 'literal', value: 'false' },
          cell: { kind: 'default' },
          hasCustomCell: false,
        },
      ],
    })
    expect(result.projection?.columns[0]?.cellSource).toContain('<Cell>')
  })

  it('does not enable table visualization for a Table nested in another root', () => {
    const result = inspectComponentSFCVisual(`<template>
  <Flex>
    <Table />
  </Flex>
</template>`)

    expect(result.support).toEqual({ kind: 'none', reason: 'root-not-table' })
    expect(result.projection).toBeNull()
  })

  it('does not enable table visualization for multiple semantic roots', () => {
    const result = inspectComponentSFCVisual(`<template>
  <Table />
  <Text>Summary</Text>
</template>`)

    expect(result.support).toEqual({ kind: 'none', reason: 'root-count' })
    expect(result.projection).toBeNull()
  })

  it('ignores whitespace-only template roots', () => {
    const result = inspectComponentSFCVisual(`<template>

  <Table />

</template>`)

    expect(result.support).toEqual({ kind: 'table' })
  })

  it('recognizes a simple attached component but keeps dynamic component code source-owned', () => {
    const managed = inspectComponentSFCVisual(`<template><Table><Column key="one"><Cell><Component is="Cell.Status" /></Cell></Column></Table></template>`)
    const dynamic = inspectComponentSFCVisual(`<template><Table><Column key="one"><Cell><Component :is="cellComponent" /></Cell></Column></Table></template>`)

    expect(managed.projection?.columns[0]?.cell).toEqual({ kind: 'component', identity: 'Cell.Status', syntax: 'cell' })
    expect(dynamic.projection?.columns[0]?.cell).toEqual({ kind: 'source' })
  })

  it('recognizes a direct user component tag without requiring a Cell wrapper', () => {
    const result = inspectComponentSFCVisual(`<template>
  <Table>
    <Column key="aircraft" title="ВС" width="200">
      <AircraftTail
        :tail="row.departureLeg.attributes[name = 'ACTail']"
        :aircraftType="row.departureLeg.attributes[name = 'ACType']"
        :configuration="row.departureLeg.attributes[name = 'ACConfig']"
      />
    </Column>
  </Table>
</template>`, {
      resolveComponentTag: tag => tag === 'AircraftTail' ? 'aircraft-tail' : null,
    })

    expect(result.projection?.columns[0]).toMatchObject({
      cell: { kind: 'component', identity: 'aircraft-tail', syntax: 'direct' },
      hasCustomCell: true,
    })
    expect(result.projection?.columns[0]?.cellSource).toContain('<AircraftTail')
  })
})
