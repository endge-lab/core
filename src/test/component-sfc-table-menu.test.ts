import { describe, expect, it } from 'vitest'

import type { RComponentSFC_IR_ElementNode } from '@/domain/types/component/sfc/ir.types'
import { compileComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-compile'
import {
  normalizeComponentSFCTableColumnMenu,
  normalizeComponentSFCTableRowMenu,
} from '@/model/services/compiler/component-sfc/component-sfc-table-menu'

describe('Component SFC table column menu', () => {
  it('compiles Table > ColumnMenu into a context menu descriptor', () => {
    const result = compileComponentSFC(createTableSource(`
      <ColumnMenu>
        <MenuItem action="table.sort.setColumnAsc" label="Сортировать по возрастанию" />
        <MenuItem action="table.sort.setColumnDesc" label="Сортировать по убыванию" />
        <MenuSeparator />
        <MenuItem action="table.sort.clearAll" label="Сбросить все сортировки" />
      </ColumnMenu>
      <Column key="number" title="Flight" sortable />
    `))
    const menu = normalizeComponentSFCTableColumnMenu(readTable(result))

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(menu.mode).toBe('inline')
    expect(menu.menu).toEqual({
      kind: 'sfc-table-menu',
      items: [
        {
          kind: 'item',
          id: 'table.sort.setColumnAsc',
          action: 'table.sort.setColumnAsc',
          label: { kind: 'literal', value: 'Сортировать по возрастанию' },
        },
        {
          kind: 'item',
          id: 'table.sort.setColumnDesc',
          action: 'table.sort.setColumnDesc',
          label: { kind: 'literal', value: 'Сортировать по убыванию' },
        },
        {
          kind: 'separator',
          id: 'separator-2',
        },
        {
          kind: 'item',
          id: 'table.sort.clearAll',
          action: 'table.sort.clearAll',
          label: { kind: 'literal', value: 'Сбросить все сортировки' },
        },
      ],
    })
  })

  it('compiles a built-in Action binding with static input', () => {
    const result = compileComponentSFC(createTableSource(`
      <ColumnMenu>
        <MenuItem
          :action="{
            identity: 'built-in-console-log',
            input: { message: 'Контекстное меню работает' },
          }"
          label="Debug"
        />
      </ColumnMenu>
      <Column key="number" title="Flight" sortable />
    `))
    const menu = normalizeComponentSFCTableColumnMenu(readTable(result))

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(menu.menu?.items).toEqual([{
      kind: 'item',
      id: 'built-in-console-log',
      action: 'built-in-console-log',
      input: { kind: 'literal', value: { message: 'Контекстное меню работает' } },
      label: { kind: 'literal', value: 'Debug' },
    }])
  })

  it('rejects payload and flattened Action input fields', () => {
    const payload = compileComponentSFC(createTableSource(`
      <ColumnMenu>
        <MenuItem :action="{ identity: 'built-in-console-log', payload: { message: 'test' } }" label="Debug" />
      </ColumnMenu>
      <Column key="number" title="Flight" sortable />
    `))
    const flattened = compileComponentSFC(createTableSource(`
      <ColumnMenu>
        <MenuItem :action="{ identity: 'built-in-console-log', message: 'test' }" label="Debug" />
      </ColumnMenu>
      <Column key="number" title="Flight" sortable />
    `))

    expect(payload.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-table-column-menu-item-action-payload-removed' }),
    ]))
    expect(flattened.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-table-column-menu-item-action-input-required' }),
    ]))
  })

  it('reports MenuItem without action or label', () => {
    const result = compileComponentSFC(createTableSource(`
      <ColumnMenu>
        <MenuItem action="table.sort.clearAll" />
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
        code: 'sfc-table-column-menu-item-action-missing',
      }),
    ]))
  })

  it('rejects removed command syntax and undeclared Actions', () => {
    const legacy = compileComponentSFC(createTableSource(`
      <ColumnMenu>
        <MenuItem command="table.sort.clearAll" label="Сбросить" />
      </ColumnMenu>
      <Column key="number" title="Flight" sortable />
    `))
    const undeclared = compileComponentSFC(createTableSource(`
      <ColumnMenu>
        <MenuItem action="flight.open" label="Открыть" />
      </ColumnMenu>
      <Column key="number" title="Flight" pinnable />
    `))

    expect(legacy.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-table-column-menu-item-command-removed' }),
    ]))
    expect(undeclared.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-table-column-menu-item-action-not-provided' }),
    ]))
  })

  it('reports Column > ColumnMenu as unsupported in v1', () => {
    const result = compileComponentSFC(createTableSource(`
      <Column key="number" title="Flight" sortable>
        <ColumnMenu>
          <MenuItem action="table.sort.clearAll" label="Сбросить все сортировки" />
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

  it('compiles RowMenu with t() label and row/cell input expressions', () => {
    const result = compileComponentSFC(createTableSource(`
      <RowMenu>
        <MenuItem
          action="built-in-console-log"
          :label="t('schedule:menu.open', 'Открыть')"
          :input="{ row, rowId, rowIndex, columnKey, value }"
        />
      </RowMenu>
      <Column key="number" title="Flight" />
    `))
    const menu = normalizeComponentSFCTableRowMenu(readTable(result))

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(menu.mode).toBe('inline')
    expect(menu.menu?.items).toEqual([expect.objectContaining({
      kind: 'item',
      action: 'built-in-console-log',
      label: expect.objectContaining({ kind: 'expression', source: "t('schedule:menu.open', 'Открыть')" }),
      input: expect.objectContaining({ kind: 'expression', source: '{ row, rowId, rowIndex, columnKey, value }' }),
    })])
  })

  it('reports conflicting legacy action.input and explicit :input', () => {
    const result = compileComponentSFC(createTableSource(`
      <RowMenu>
        <MenuItem
          :action="{ identity: 'built-in-console-log', input: { source: 'legacy' } }"
          :input="{ rowId }"
          label="Debug"
        />
      </RowMenu>
    `))

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-table-row-menu-item-input-conflict' }),
    ]))
  })

  it('expands a namespaced forwarded alias to the Action of the same mounted Table', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
const ports = definePorts({
  forward: {
    from: 'schedule',
    namespace: 'schedule',
    ports: { provides: ['table.sort.clearAll'] },
  },
})
</script>
<template>
  <Table ref="schedule" :rows="[]">
    <ColumnMenu><MenuItem action="schedule.table.sort.clearAll" label="Сбросить" /></ColumnMenu>
  </Table>
</template>`)
    const menu = readTable(result).tableMenus?.column

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(menu?.menu?.items[0]).toMatchObject({
      kind: 'item',
      action: 'table.sort.clearAll',
      forwardedFrom: { ref: 'schedule', portName: 'table.sort.clearAll' },
    })
  })

  it('rejects a forwarded Action owned by another mounted Table', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
const ports = definePorts({
  forward: {
    from: 'other',
    namespace: 'other',
    ports: { provides: ['table.sort.clearAll'] },
  },
})
</script>
<template>
  <Table ref="schedule" :rows="[]">
    <ColumnMenu><MenuItem action="other.table.sort.clearAll" label="Сбросить" /></ColumnMenu>
  </Table>
  <Table ref="other" :rows="[]" />
</template>`)

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-table-column-menu-item-action-target-incompatible' }),
    ]))
  })
})

function createTableSource(children: string, options: { tableAttrs?: string } = {}): string {
  return `<script setup lang="ts">
defineProps<{
  rows: unknown[]
}>()

const ports = definePorts({
  provides: {
    'table.sort.setColumnAsc': action<unknown, void>(),
    'table.sort.setColumnDesc': action<unknown, void>(),
    'table.sort.clearAll': action<unknown, void>(),
  },
})
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
