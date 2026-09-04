import type { RComponentSFC_IR_ElementNode } from '@/features/core/modules/domain/types/component/sfc/ir.types'

import { describe, expect, it } from 'vitest'
import { compileComponentSFC } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-compile'
import {
  normalizeComponentSFCTableColumnMenu,
  normalizeComponentSFCTableRowMenu,
} from '@/features/core/modules/compiler/services/component-sfc/component-sfc-table-menu'

describe('меню колонки таблицы Component SFC', () => {
  it('компилирует Table > ColumnMenu в дескриптор контекстного меню', () => {
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

  it('компилирует встроенный binding Action со статическим input', () => {
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

  it('отклоняет payload и развёрнутые поля input Action', () => {
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

  it('сообщает о MenuItem без action или label', () => {
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

  it('отклоняет удалённый синтаксис command и разрешает прямой identity Action без порта', () => {
    const legacy = compileComponentSFC(createTableSource(`
      <ColumnMenu>
        <MenuItem command="table.sort.clearAll" label="Сбросить" />
      </ColumnMenu>
      <Column key="number" title="Flight" sortable />
    `))
    const direct = compileComponentSFC(createTableSource(`
      <ColumnMenu>
        <MenuItem action="flight.open" label="Открыть" />
      </ColumnMenu>
      <Column key="number" title="Flight" pinnable />
    `))

    expect(legacy.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-table-column-menu-item-command-removed' }),
    ]))
    expect(direct.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(readTable(direct).tableMenus?.column.menu?.items[0]).toMatchObject({
      kind: 'item',
      action: 'flight.open',
    })
    expect(direct.dependencies.actions).toContain('flight.open')
  })

  it('разрешает expression-ссылку на порт Action и сохраняет legacy string alias', () => {
    const source = (action: string) => `<script setup lang="ts">
const ports = definePorts({
  require: {
    publishSchedule: action<{ rowId: string }, void>({ default: 'aodb.schedule.open-publish-dialog' }),
  },
})
</script>
<template>
  <Table :rows="[]">
    <RowMenu><MenuItem ${action} label="Опубликовать" :input="{ rowId }" /></RowMenu>
  </Table>
</template>`

    const expression = compileComponentSFC(source(':action="publishSchedule"'))
    const qualified = compileComponentSFC(source(':action="ports.require.publishSchedule"'))
    const legacy = compileComponentSFC(source('action="publishSchedule"'))

    for (const result of [expression, qualified, legacy]) {
      expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
      expect(readTable(result).tableMenus?.row.menu?.items[0]).toMatchObject({
        kind: 'item',
        action: 'aodb.schedule.open-publish-dialog',
      })
      expect(result.dependencies.actions).toContain('aodb.schedule.open-publish-dialog')
    }
  })

  it('отклоняет expression-ссылку на Action, не объявленную как порт', () => {
    const result = compileComponentSFC(createTableSource(`
      <RowMenu><MenuItem :action="missingActionPort" label="Открыть" /></RowMenu>
    `))

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-table-row-menu-item-action-port-missing' }),
    ]))
  })

  it('сообщает, что Column > ColumnMenu не поддерживается в v1', () => {
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

  it('поддерживает отключённый column-menu без дескриптора меню', () => {
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

  it('компилирует RowMenu с label через t() и выражениями input строки и ячейки', () => {
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
      label: expect.objectContaining({ kind: 'expression', source: 't(\'schedule:menu.open\', \'Открыть\')' }),
      input: expect.objectContaining({ kind: 'expression', source: '{ row, rowId, rowIndex, columnKey, value }' }),
    })])
  })

  it('сообщает о конфликте legacy action.input и явного :input', () => {
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

  it('раскрывает перенаправленный alias с namespace в Action той же смонтированной Table', () => {
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
    <ColumnMenu><MenuItem :action="ports.provides['schedule.table.sort.clearAll']" label="Сбросить" /></ColumnMenu>
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

  it('отклоняет перенаправленный Action, принадлежащий другой смонтированной Table', () => {
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
    <ColumnMenu><MenuItem :action="ports.provides['other.table.sort.clearAll']" label="Сбросить" /></ColumnMenu>
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
  if (!node || node.kind !== 'element' || node.tag !== 'Table') {
    throw new Error('Expected root Table node.')
  }

  return node
}
