import { describe, expect, it } from 'vitest'

import { patchComponentSFCTableSource } from '@/model/services/source-engine/component-sfc/component-sfc-table-source-patch'

describe('Component SFC Table source patch', () => {
  it('adds a column before the closing Table tag without changing surrounding source', () => {
    const source = `<template>
  <Table :rows="rows">
    <!-- keep this comment -->
    <Column key="flight" title="Flight" />
  </Table>
</template>`

    const result = patchComponentSFCTableSource(source, { type: 'add-column' })

    expect(result.ok).toBe(true)
    expect(result.source).toContain('<!-- keep this comment -->')
    expect(result.source).toContain('<Column key="column_2" title="Новая колонка" />')
    expect(result.projection?.columns).toHaveLength(2)
  })

  it('updates only one static attribute and refuses to overwrite a dynamic expression', () => {
    const source = `<template>
  <Table>
    <Column key="flight" title="Flight" :width="columnWidth" />
  </Table>
</template>`

    const title = patchComponentSFCTableSource(source, {
      type: 'set-column-attribute',
      columnIndex: 0,
      name: 'title',
      value: 'Flight number',
    })
    const width = patchComponentSFCTableSource(title.source, {
      type: 'set-column-attribute',
      columnIndex: 0,
      name: 'width',
      value: '180',
    })

    expect(title.ok).toBe(true)
    expect(title.source).toContain('title="Flight number" :width="columnWidth"')
    expect(width.ok).toBe(false)
    expect(width.source).toBe(title.source)
    expect(width.message).toContain('Source')
  })

  it('moves exact Column fragments while preserving comments and formatting between slots', () => {
    const source = `<template>
  <Table>
    <Column key="first" title="First" />
    <!-- separator stays untouched -->
    <Column
      key="second"
      title="Second"
    />
  </Table>
</template>`

    const result = patchComponentSFCTableSource(source, {
      type: 'move-column',
      fromIndex: 1,
      toIndex: 0,
    })

    expect(result.ok).toBe(true)
    expect(result.source).toContain('<!-- separator stays untouched -->')
    expect(result.projection?.columns.map(column => column.key)).toEqual([
      { kind: 'literal', value: 'second' },
      { kind: 'literal', value: 'first' },
    ])
  })

  it('attaches, replaces and removes a managed component cell', () => {
    const source = `<template>
  <Table>
    <Column key="status" title="Status" />
  </Table>
</template>`

    const attached = patchComponentSFCTableSource(source, {
      type: 'set-column-component',
      columnIndex: 0,
      identity: 'Cell.Status',
    })
    const replaced = patchComponentSFCTableSource(attached.source, {
      type: 'set-column-component',
      columnIndex: 0,
      identity: 'Cell.Badge',
    })
    const removed = patchComponentSFCTableSource(replaced.source, {
      type: 'set-column-component',
      columnIndex: 0,
      identity: null,
    })

    expect(attached.ok).toBe(true)
    expect(attached.source).toContain('<Component is="Cell.Status" />')
    expect(replaced.source).toContain('<Component is="Cell.Badge" />')
    expect(replaced.source).not.toContain('Cell.Status')
    expect(removed.source).not.toContain('<Cell>')
    expect(removed.projection?.columns[0]?.cell).toEqual({ kind: 'default' })
  })

  it('does not overwrite arbitrary Cell source', () => {
    const source = `<template>
  <Table>
    <Column key="status">
      <Cell>
        <Badge>{{ row.status }}</Badge>
      </Cell>
    </Column>
  </Table>
</template>`

    const result = patchComponentSFCTableSource(source, {
      type: 'set-column-component',
      columnIndex: 0,
      identity: 'Cell.Status',
    })

    expect(result.ok).toBe(false)
    expect(result.source).toBe(source)
    expect(result.message).toContain('Source')
  })

  it('does not remove comments stored inside a managed-looking Cell', () => {
    const source = `<template><Table><Column key="status"><Cell><!-- keep --><Component is="Cell.Status" /></Cell></Column></Table></template>`

    const result = patchComponentSFCTableSource(source, {
      type: 'set-column-component',
      columnIndex: 0,
      identity: null,
    })

    expect(result.ok).toBe(false)
    expect(result.source).toBe(source)
    expect(result.projection?.columns[0]?.cell).toEqual({ kind: 'source' })
  })

  it('removes only the selected Column line', () => {
    const source = `<template>
  <Table>
    <Column key="first" />
    <!-- keep -->
    <Column key="second" />
  </Table>
</template>`

    const result = patchComponentSFCTableSource(source, {
      type: 'remove-column',
      columnIndex: 0,
    })

    expect(result.ok).toBe(true)
    expect(result.source).not.toContain('key="first"')
    expect(result.source).toContain('<!-- keep -->')
    expect(result.source).toContain('key="second"')
  })
})
