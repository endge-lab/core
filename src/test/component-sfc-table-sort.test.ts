import { describe, expect, it } from 'vitest'

import type { RComponentSFC_IR_ElementNode } from '@/domain/types/component/sfc'
import { compileComponentSFC } from '@/model/services/compiler/component-sfc-compile'
import { normalizeComponentSFCTableSort } from '@/model/services/compiler/component-sfc-table-sort'

describe('Component SFC table sorting', () => {
  it('uses natural comparator for sortable columns without explicit sort', () => {
    const result = compileComponentSFC(createTableSource(`
      <Column key="number" title="Flight" sortable />
    `))
    const sort = normalizeComponentSFCTableSort(readTable(result))

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(sort.columns).toEqual([
      {
        key: 'number',
        sortable: true,
        comparator: 'natural',
        paths: ['number'],
      },
    ])
  })

  it('parses explicit comparator and comma-separated sort-by paths', () => {
    const result = compileComponentSFC(createTableSource(`
      <Column key="flight" title="Flight" sortable sort-by="flightCarrier, flightNumber" />
      <Column key="std" title="STD" sortable sort="date" />
    `))
    const sort = normalizeComponentSFCTableSort(readTable(result))

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(sort.columns).toMatchObject([
      {
        key: 'flight',
        comparator: 'natural',
        paths: ['flightCarrier', 'flightNumber'],
      },
      {
        key: 'std',
        comparator: 'date',
        paths: ['std'],
      },
    ])
  })

  it('reports invalid comparator', () => {
    const result = compileComponentSFC(createTableSource(`
      <Column key="std" title="STD" sortable sort="weekday" />
    `))

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        code: 'sfc-table-sort-comparator-invalid',
      }),
    ]))
  })

  it('reports invalid default-sort direction and missing sortable column', () => {
    const result = compileComponentSFC(createTableSource(`
      <Column key="std" title="STD" sortable sort="date" />
      <Column key="route" title="Route" />
    `, {
      tableAttrs: 'default-sort="std:up,route:asc"',
    }))

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        code: 'sfc-table-default-sort-invalid',
      }),
      expect.objectContaining({
        severity: 'error',
        code: 'sfc-table-default-sort-column-missing',
      }),
    ]))
  })
})

function createTableSource(columns: string, options: { tableAttrs?: string } = {}): string {
  return `<script setup lang="ts">
defineProps<{
  rows: unknown[]
}>()
</script>

<template>
  <Table :rows="rows" row-key="id" ${options.tableAttrs ?? ''}>
    ${columns}
  </Table>
</template>`
}

function readTable(result: ReturnType<typeof compileComponentSFC>): RComponentSFC_IR_ElementNode {
  const node = result.ir?.template.roots[0]
  if (!node || node.kind !== 'element' || node.tag !== 'Table')
    throw new Error('Expected root Table node.')

  return node
}
