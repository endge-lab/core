import { describe, expect, it } from 'vitest'

import type { RComponentSFC_IR_ElementNode } from '@/domain/types/component-sfc.types'
import { compileComponentSFC } from '@/model/services/compiler/component-sfc-compile'
import { normalizeComponentSFCTableColumnMenu } from '@/model/services/compiler/component-sfc-table-menu'

describe('Component SFC table column menu', () => {
  it('compiles Table > ColumnMenu into a context menu descriptor', () => {
    const result = compileComponentSFC(createTableSource(`
      <ColumnMenu>
        <MenuItem command="table.sort.setColumnAsc" label="Сортировать по возрастанию" />
        <MenuItem command="table.sort.setColumnDesc" label="Сортировать по убыванию" />
        <MenuSeparator />
        <MenuItem command="table.sort.clearAll" label="Сбросить все сортировки" />
      </ColumnMenu>
      <Column key="number" title="Flight" sortable />
    `))
    const menu = normalizeComponentSFCTableColumnMenu(readTable(result))

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(menu.mode).toBe('inline')
    expect(menu.menu).toEqual({
      kind: 'context-menu',
      items: [
        {
          kind: 'item',
          id: 'table.sort.setColumnAsc',
          command: 'table.sort.setColumnAsc',
          label: 'Сортировать по возрастанию',
        },
        {
          kind: 'item',
          id: 'table.sort.setColumnDesc',
          command: 'table.sort.setColumnDesc',
          label: 'Сортировать по убыванию',
        },
        {
          kind: 'separator',
          id: 'separator-2',
        },
        {
          kind: 'item',
          id: 'table.sort.clearAll',
          command: 'table.sort.clearAll',
          label: 'Сбросить все сортировки',
        },
      ],
    })
  })

  it('reports MenuItem without command or label', () => {
    const result = compileComponentSFC(createTableSource(`
      <ColumnMenu>
        <MenuItem command="table.sort.clearAll" />
        <MenuItem label="Сбросить все сортировки" />
      </ColumnMenu>
      <Column key="number" title="Flight" sortable />
    `))

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        code: 'sfc-table-column-menu-item-label-missing',
      }),
      expect.objectContaining({
        severity: 'error',
        code: 'sfc-table-column-menu-item-command-missing',
      }),
    ]))
  })

  it('reports Column > ColumnMenu as unsupported in v1', () => {
    const result = compileComponentSFC(createTableSource(`
      <Column key="number" title="Flight" sortable>
        <ColumnMenu>
          <MenuItem command="table.sort.clearAll" label="Сбросить все сортировки" />
        </ColumnMenu>
      </Column>
    `))

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        code: 'sfc-table-column-menu-placement-unsupported',
      }),
    ]))
  })

  it('supports column-menu disabled without a menu descriptor', () => {
    const result = compileComponentSFC(createTableSource(`
      <Column key="number" title="Flight" sortable />
    `, {
      tableAttrs: 'column-menu="disabled"',
    }))
    const menu = normalizeComponentSFCTableColumnMenu(readTable(result))

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(menu.mode).toBe('disabled')
    expect(menu.menu).toBeNull()
  })
})

function createTableSource(children: string, options: { tableAttrs?: string } = {}): string {
  return `<script setup lang="ts">
defineProps<{
  rows: unknown[]
}>()
</script>

<template>
  <Table :rows="rows" row-key="id" ${options.tableAttrs ?? ''}>
    ${children}
  </Table>
</template>`
}

function readTable(result: ReturnType<typeof compileComponentSFC>): RComponentSFC_IR_ElementNode {
  const node = result.ir?.template.roots[0]
  if (!node || node.kind !== 'element' || node.tag !== 'Table')
    throw new Error('Expected root Table node.')

  return node
}
