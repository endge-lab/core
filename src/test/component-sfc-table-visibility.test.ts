import type { RComponentSFC_IR_ElementNode } from '@/features/core/modules/domain/types/component/sfc/ir.types'

import { describe, expect, it } from 'vitest'
import { compileComponentSFC } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-compile'
import { normalizeComponentSFCTableColumnVisibility } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-table-visibility'

describe('видимость колонок таблицы Component SFC', () => {
  it('разбирает default-hidden как разреженный список ключей скрытых колонок', () => {
    const result = compileComponentSFC(createTableSource(
      '<Column key="flight" /><Column key="status" /><Column key="gate" />',
      'default-hidden="status,gate"',
    ))
    const visibility = normalizeComponentSFCTableColumnVisibility(readTable(result))

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(visibility.defaultHidden).toEqual(['status', 'gate'])
  })

  it('сообщает об отсутствующих и дублирующихся ключах колонок', () => {
    const result = compileComponentSFC(createTableSource(
      '<Column key="flight" /><Column key="status" />',
      'default-hidden="status,missing,status"',
    ))

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        code: 'sfc-table-default-hidden-column-missing',
      }),
      expect.objectContaining({
        severity: 'error',
        code: 'sfc-table-default-hidden-duplicate',
      }),
    ]))
  })
})

function createTableSource(columns: string, tableAttrs = ''): string {
  return `<template><Table ${tableAttrs}>${columns}</Table></template>`
}

function readTable(result: ReturnType<typeof compileComponentSFC>): RComponentSFC_IR_ElementNode {
  const node = result.ir?.template.roots[0]
  if (!node || node.kind !== 'element' || node.tag !== 'Table') {
    throw new Error('Expected root Table node.')
  }

  return node
}
