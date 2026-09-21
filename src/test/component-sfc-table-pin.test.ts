import type { RComponentSFC_IR_ElementNode } from '@/features/core/modules/domain/types/component/sfc/ir.types'

import { describe, expect, it } from 'vitest'
import { compileComponentSFC } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-compile'
import { normalizeComponentSFCTableColumnPin } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-table-pin'

describe('закрепление колонок таблицы Component SFC', () => {
  it('разбирает состояние default-pin уровня таблицы', () => {
    const result = compileComponentSFC(createTableSource(`
      <Column key="number" title="Flight" />
      <Column key="status" title="Status" />
    `, {
      tableAttrs: 'default-pin="number:left,status:right"',
    }))
    const pin = normalizeComponentSFCTableColumnPin(readTable(result))

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(pin.mode).toBe('enabled')
    expect(pin.defaultPin).toEqual([
      { key: 'number', side: 'left' },
      { key: 'status', side: 'right' },
    ])
  })

  it('сообщает о невалидной стороне default-pin, отсутствующей колонке и дублирующемся ключе', () => {
    const result = compileComponentSFC(createTableSource(`
      <Column key="number" title="Flight" />
    `, {
      tableAttrs: 'default-pin="number:start,missing:left,number:left,number:right"',
    }))

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        code: 'sfc-table-default-pin-invalid',
      }),
      expect.objectContaining({
        severity: 'error',
        code: 'sfc-table-default-pin-column-missing',
      }),
      expect.objectContaining({
        severity: 'error',
        code: 'sfc-table-default-pin-duplicate',
      }),
    ]))
  })

  it('поддерживает отключённый column-pin без состояния закрепления по умолчанию', () => {
    const result = compileComponentSFC(createTableSource(`
      <Column key="number" title="Flight" />
    `, {
      tableAttrs: 'column-pin="disabled" default-pin="number:left"',
    }))
    const pin = normalizeComponentSFCTableColumnPin(readTable(result))

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'warning',
        code: 'sfc-table-default-pin-disabled',
      }),
    ]))
    expect(pin.mode).toBe('disabled')
    expect(pin.defaultPin).toEqual([])
  })

  it('читает возможность закрепления для каждой колонки', () => {
    const result = compileComponentSFC(createTableSource(`
      <Column key="number" title="Flight" />
      <Column key="actions" title="" pinnable="false" />
    `))
    const pin = normalizeComponentSFCTableColumnPin(readTable(result))

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(pin.columns).toEqual([
      { key: 'number', pinnable: true },
      { key: 'actions', pinnable: false },
    ])
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
  if (!node || node.kind !== 'element' || node.tag !== 'Table') {
    throw new Error('Expected root Table node.')
  }

  return node
}
