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

  it('enables sortable without changing other Column attributes', () => {
    const source = `<template><Table><Column key="flight" title="Flight" /></Table></template>`

    const result = patchComponentSFCTableSource(source, {
      type: 'set-column-attribute',
      columnIndex: 0,
      name: 'sortable',
      value: 'true',
    })

    expect(result.ok).toBe(true)
    expect(result.source).toContain('<Column key="flight" title="Flight" sortable="true" />')
    expect(result.projection?.columns[0]?.sortable).toEqual({ kind: 'literal', value: 'true' })
  })

  it('adds, updates and removes editable Table attributes without touching its children', () => {
    const source = `<template>
  <Table :rows="rows">
    <!-- keep this comment -->
    <Column key="flight" title="Flight" />
  </Table>
</template>`

    const patches = [
      { type: 'set-table-attribute', name: 'paging', value: 'pages' },
      { type: 'set-table-attribute', name: 'page-size', value: '25' },
      { type: 'set-table-attribute', name: 'page-sizes', value: '10,25,50' },
      { type: 'set-table-attribute', name: 'default-pin', value: 'flight:left' },
      { type: 'set-table-attribute', name: 'default-sort', value: 'flight:asc' },
      { type: 'set-table-attribute', name: 'default-hidden', value: 'flight' },
    ] as const

    const updated = patches.reduce(
      (nextSource, patch) => patchComponentSFCTableSource(nextSource, patch).source,
      source,
    )

    expect(updated).toContain(':rows="rows"')
    expect(updated).toContain('paging="pages"')
    expect(updated).toContain('page-size="25"')
    expect(updated).toContain('page-sizes="10,25,50"')
    expect(updated).toContain('default-pin="flight:left"')
    expect(updated).toContain('default-sort="flight:asc"')
    expect(updated).toContain('default-hidden="flight"')
    expect(updated).toContain('<!-- keep this comment -->')
    expect(updated).toContain('<Column key="flight" title="Flight" />')

    const removed = patchComponentSFCTableSource(updated, {
      type: 'set-table-attribute',
      name: 'page-size',
      value: null,
    })

    expect(removed.ok).toBe(true)
    expect(removed.source).not.toContain('page-size="25"')
    expect(removed.projection?.pageSize).toBeNull()
  })

  it('does not overwrite a dynamic Table attribute from the visual editor', () => {
    const source = `<template><Table :default-sort="sortState"><Column key="flight" /></Table></template>`

    const result = patchComponentSFCTableSource(source, {
      type: 'set-table-attribute',
      name: 'default-sort',
      value: 'flight:asc',
    })

    expect(result.ok).toBe(false)
    expect(result.source).toBe(source)
    expect(result.message).toContain('Source')
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

  it('selects and replaces a managed built-in tag without creating a parallel model', () => {
    const source = '<template><Table><Column key="delay" /></Table></template>'

    const attached = patchComponentSFCTableSource(source, {
      type: 'set-column-tag',
      columnIndex: 0,
      tag: 'Number',
    })
    const replaced = patchComponentSFCTableSource(attached.source, {
      type: 'set-column-tag',
      columnIndex: 0,
      tag: 'Text',
      syntax: 'cell',
    })
    const component = patchComponentSFCTableSource(replaced.source, {
      type: 'set-column-component',
      columnIndex: 0,
      identity: 'Cell.Delay',
      syntax: 'cell',
    })

    expect(attached.source).toContain('<Number :value="value" />')
    expect(attached.projection?.columns[0]?.cell).toEqual({
      kind: 'tag',
      tag: 'Number',
      syntax: 'cell',
      bindings: [{ name: 'value', value: { kind: 'expression', source: 'value' }, sourceRange: expect.any(Object) }],
    })
    expect(replaced.source).toContain('<Text :value="value" />')
    expect(component.source).toContain('<Component is="Cell.Delay" />')
    expect(component.projection?.columns[0]?.cell).toEqual({ kind: 'component', identity: 'Cell.Delay', syntax: 'cell', bindings: [] })
  })

  it('does not overwrite arbitrary Cell source', () => {
    const source = `<template>
  <Table>
    <Column key="status">
      <Cell>
        <Badge>{{ row.status }}</Badge>
        <Text>{{ row.label }}</Text>
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

  it('does not duplicate a direct component when applying a managed cell patch', () => {
    const source = `<template><Table><Column key="aircraft"><AircraftTail :tail="row.tail" /></Column></Table></template>`

    const result = patchComponentSFCTableSource(source, {
      type: 'set-column-component',
      columnIndex: 0,
      identity: 'aircraft-status',
    })

    expect(result.ok).toBe(false)
    expect(result.source).toBe(source)
    expect(result.source).not.toContain('<Cell>')
    expect(result.message).toContain('Source')
  })

  it('replaces and removes a direct component while preserving its bindings', () => {
    const source = `<template>
  <Table>
    <Column key="aircraft">
      <AircraftTail :tail="row.tail" configuration="default" />
    </Column>
  </Table>
</template>`

    const replaced = patchComponentSFCTableSource(source, {
      type: 'set-column-component',
      columnIndex: 0,
      identity: 'aircraft-status',
      syntax: 'direct',
    })
    const updated = patchComponentSFCTableSource(replaced.source, {
      type: 'set-column-component',
      columnIndex: 0,
      identity: 'aircraft-card',
      syntax: 'direct',
    })
    const removed = patchComponentSFCTableSource(updated.source, {
      type: 'set-column-component',
      columnIndex: 0,
      identity: null,
      syntax: 'direct',
    })

    expect(replaced.ok).toBe(true)
    expect(replaced.source).toContain('<Component :tail="row.tail" configuration="default" is="aircraft-status" />')
    expect(replaced.source).not.toContain('<Cell>')
    expect(updated.ok).toBe(true)
    expect(updated.source).toContain('is="aircraft-card"')
    expect(updated.source).not.toContain('aircraft-status')
    expect(removed.ok).toBe(true)
    expect(removed.source).not.toContain('<Component')
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

  it('adds, converts and removes a managed component prop binding', () => {
    const source = `<template>
  <Table>
    <Column key="aircraft">
      <Cell>
        <Component is="AircraftTail" configuration="default" />
      </Cell>
    </Column>
  </Table>
</template>`

    const added = patchComponentSFCTableSource(source, {
      type: 'set-column-cell-attribute',
      columnIndex: 0,
      name: 'tail',
      value: "row.departureLeg.attributes[name = 'ACTail']",
      valueKind: 'expression',
    })
    const converted = patchComponentSFCTableSource(added.source, {
      type: 'set-column-cell-attribute',
      columnIndex: 0,
      name: 'configuration',
      value: 'row.configuration',
      valueKind: 'expression',
    })
    const removed = patchComponentSFCTableSource(converted.source, {
      type: 'set-column-cell-attribute',
      columnIndex: 0,
      name: 'tail',
      value: null,
      valueKind: 'expression',
    })

    expect(added.ok).toBe(true)
    expect(added.source).toContain(`:tail="row.departureLeg.attributes[name = 'ACTail']"`)
    expect(converted.source).toContain(':configuration="row.configuration"')
    expect(converted.source).not.toContain('configuration="default"')
    expect(removed.ok).toBe(true)
    expect(removed.source).not.toContain(':tail=')
    expect(removed.source).toContain(':configuration="row.configuration"')
  })

  it('refuses an invalid expression and preserves the previous Source', () => {
    const source = '<template><Table><Column key="one"><Cell><Text /></Cell></Column></Table></template>'
    const result = patchComponentSFCTableSource(source, {
      type: 'set-column-cell-attribute',
      columnIndex: 0,
      name: 'value',
      value: 'row.[broken',
      valueKind: 'expression',
    })

    expect(result.ok).toBe(false)
    expect(result.source).toBe(source)
    expect(result.message).toContain('Не удалось разобрать выражение')
  })

  it('updates bindings of a direct component tag without rewriting its syntax', () => {
    const source = `<template><Table><Column key="aircraft"><AircraftTail :tail="row.tail" /></Column></Table></template>`
    const result = patchComponentSFCTableSource(source, {
      type: 'set-column-cell-attribute',
      columnIndex: 0,
      name: 'configuration',
      value: "row.departureLeg.attributes[name = 'ACConfig']",
      valueKind: 'expression',
    })

    expect(result.ok).toBe(true)
    expect(result.source).toContain('<AircraftTail')
    expect(result.source).toContain(':tail="row.tail"')
    expect(result.source).toContain(`:configuration="row.departureLeg.attributes[name = 'ACConfig']"`)
    expect(result.source).not.toContain('<Component')
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
