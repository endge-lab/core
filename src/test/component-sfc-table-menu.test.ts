import { describe, expect, it } from 'vitest'

import type { RComponentSFC_IR_ElementNode } from '@/domain/types/component/sfc'
import { compileComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-compile'
import { normalizeComponentSFCTableColumnMenu } from '@/model/services/compiler/component-sfc/component-sfc-table-menu'

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
      kind: 'context-menu',
      items: [
        {
          kind: 'item',
          id: 'table.sort.setColumnAsc',
          action: 'table.sort.setColumnAsc',
          label: 'Сортировать по возрастанию',
        },
        {
          kind: 'item',
          id: 'table.sort.setColumnDesc',
          action: 'table.sort.setColumnDesc',
          label: 'Сортировать по убыванию',
        },
        {
          kind: 'separator',
          id: 'separator-2',
        },
        {
          kind: 'item',
          id: 'table.sort.clearAll',
          action: 'table.sort.clearAll',
          label: 'Сбросить все сортировки',
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
      input: { message: 'Контекстное меню работает' },
      label: 'Debug',
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
