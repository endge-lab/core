import { describe, expect, it } from 'vitest'

import { patchComponentSFCTableSource } from '@/features/core/modules/source/services/component-sfc/component-sfc-table-source-patch'

describe('изменение Table в Source компонента SFC', () => {
  it('добавляет столбец перед закрывающим тегом Table без изменения окружающего Source', () => {
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

  it('обновляет только один статический атрибут и не перезаписывает динамическое выражение', () => {
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

  it('включает sortable без изменения других атрибутов Column', () => {
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

  it('независимо записывает настройки сортировки без удаления упорядоченных путей sort-by', () => {
    const source = `<template><Table><Column key="aircraft" /></Table></template>`
    const withComparator = patchComponentSFCTableSource(source, {
      type: 'set-column-attribute',
      columnIndex: 0,
      name: 'sort',
      value: 'text',
    })
    const withPaths = patchComponentSFCTableSource(withComparator.source, {
      type: 'set-column-attribute',
      columnIndex: 0,
      name: 'sort-by',
      value: 'departureLeg.aircraft.tail,departureLeg.aircraft.type',
    })
    const changedComparator = patchComponentSFCTableSource(withPaths.source, {
      type: 'set-column-attribute',
      columnIndex: 0,
      name: 'sort',
      value: 'natural',
    })
    const withDirection = patchComponentSFCTableSource(changedComparator.source, {
      type: 'set-table-attribute',
      name: 'default-sort',
      value: 'aircraft:desc',
    })

    expect(withDirection.ok).toBe(true)
    expect(withDirection.source).toContain('sort="natural"')
    expect(withDirection.source).toContain('sort-by="departureLeg.aircraft.tail,departureLeg.aircraft.type"')
    expect(withDirection.source).toContain('default-sort="aircraft:desc"')
    expect(withDirection.projection?.columns[0]?.sort).toEqual({ kind: 'literal', value: 'natural' })
    expect(withDirection.projection?.columns[0]?.sortBy).toEqual({
      kind: 'literal',
      value: 'departureLeg.aircraft.tail,departureLeg.aircraft.type',
    })
  })

  it('добавляет, обновляет и удаляет редактируемые атрибуты Table, не затрагивая дочерние узлы', () => {
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

  it('не перезаписывает динамический атрибут Table из визуального редактора', () => {
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

  it('перемещает точные фрагменты Column, сохраняя комментарии и форматирование между слотами', () => {
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

  it('присоединяет, заменяет и удаляет управляемую ячейку компонента', () => {
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

  it('выбирает и заменяет управляемый встроенный тег без создания параллельной модели', () => {
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

  it('не перезаписывает произвольный Source ячейки Cell', () => {
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

  it('не дублирует прямой компонент при применении управляемого изменения ячейки', () => {
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

  it('материализует взаимодействия Cell без замены существующего прямого Source столбца', () => {
    const source = `<template>
  <Table>
    <Column key="status">
      <!-- preserved -->
      <Badge>{{ row.status }}</Badge>
    </Column>
    <Column key="flight" />
  </Table>
</template>`
    const interaction = `{ event: 'click', modifiers: { shift: true }, reaction: action({ identity: 'cell.open', input: { row, columnKey } }) }`

    const wrapped = patchComponentSFCTableSource(source, {
      type: 'set-column-cell-on',
      columnIndex: 0,
      value: interaction,
    })
    const materialized = patchComponentSFCTableSource(wrapped.source, {
      type: 'set-column-cell-on',
      columnIndex: 1,
      value: interaction,
    })

    expect(wrapped.ok).toBe(true)
    expect(wrapped.source).toContain('<!-- preserved -->')
    expect(wrapped.source).toContain('<Badge>{{ row.status }}</Badge>')
    expect(wrapped.source).toContain('<Cell :on="{ event: \'click\'')
    expect(materialized.ok).toBe(true)
    expect(materialized.source).toMatch(/<Column key="flight"\s*>/)
    expect(materialized.source).toContain('{{ value }}</Cell>')
    expect(materialized.projection?.columns[0]?.interactions).toMatchObject({
      editable: true,
      rules: [expect.objectContaining({
        event: 'click',
        modifiers: { shift: true },
      })],
    })
    expect(materialized.projection?.columns[1]?.interactions.rules[0]?.event).toBe('click')
  })

  it('сохраняет suffix-модификаторы Cell при редактировании и удаляет только аннотацию', () => {
    const source = `<template><Table><Column key="status"><Cell :on.stop="{ event: 'click', reaction: action({ identity: 'old' }) }"><Text>{{ value }}</Text></Cell></Column></Table></template>`
    const updated = patchComponentSFCTableSource(source, {
      type: 'set-column-cell-on',
      columnIndex: 0,
      value: `{ event: 'dblclick', reaction: action({ identity: 'next' }) }`,
    })
    const removed = patchComponentSFCTableSource(updated.source, {
      type: 'set-column-cell-on',
      columnIndex: 0,
      value: null,
    })

    expect(updated.ok).toBe(true)
    expect(updated.source).toContain(':on.stop=')
    expect(updated.projection?.columns[0]?.interactions.suffixes).toEqual(['stop'])
    expect(removed.ok).toBe(true)
    expect(removed.source).not.toContain(':on')
    expect(removed.source).toContain('<Text>{{ value }}</Text>')
  })

  it('не фиксирует некорректное визуальное взаимодействие Cell', () => {
    const source = '<template><Table><Column key="status" /></Table></template>'
    const result = patchComponentSFCTableSource(source, {
      type: 'set-column-cell-on',
      columnIndex: 0,
      value: `{ event: 'click', reaction: broken( }`,
    })

    expect(result.ok).toBe(false)
    expect(result.source).toBe(source)
    expect(result.message).toContain(':on')
  })

  it('заменяет и удаляет прямой компонент, сохраняя его bindings', () => {
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

  it('не удаляет комментарии внутри Cell, внешне похожей на управляемую', () => {
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

  it('добавляет, преобразует и удаляет управляемый binding prop компонента', () => {
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
      value: 'row.departureLeg.attributes[name = \'ACTail\']',
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

  it('отклоняет некорректное выражение и сохраняет предыдущий Source', () => {
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

  it('обновляет bindings прямого тега компонента без перезаписи его синтаксиса', () => {
    const source = `<template><Table><Column key="aircraft"><AircraftTail :tail="row.tail" /></Column></Table></template>`
    const result = patchComponentSFCTableSource(source, {
      type: 'set-column-cell-attribute',
      columnIndex: 0,
      name: 'configuration',
      value: 'row.departureLeg.attributes[name = \'ACConfig\']',
      valueKind: 'expression',
    })

    expect(result.ok).toBe(true)
    expect(result.source).toContain('<AircraftTail')
    expect(result.source).toContain(':tail="row.tail"')
    expect(result.source).toContain(`:configuration="row.departureLeg.attributes[name = 'ACConfig']"`)
    expect(result.source).not.toContain('<Component')
  })

  it('удаляет только строку выбранного Column', () => {
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

  it('обеспечивает round-trip метки t() в CellMenu и динамического input строки через узкие изменения', () => {
    const source = '<template><Table><Column key="flight" /></Table></template>'
    const custom = patchComponentSFCTableSource(source, { type: 'set-menu-mode', menu: 'row', mode: 'custom' })
    const added = patchComponentSFCTableSource(custom.source, { type: 'add-menu-node', menu: 'row', node: 'item' })
    const label = patchComponentSFCTableSource(added.source, {
      type: 'set-menu-item-attribute',
      menu: 'row',
      nodeIndex: 0,
      name: 'label',
      value: 't(\'schedule:menu.open\', \'Открыть\')',
      valueKind: 'expression',
    })
    const input = patchComponentSFCTableSource(label.source, {
      type: 'set-menu-item-attribute',
      menu: 'row',
      nodeIndex: 0,
      name: 'input',
      value: '{ rowId, columnKey, value }',
      valueKind: 'expression',
    })

    expect(input.ok).toBe(true)
    expect(input.source).toContain('<CellMenu>')
    expect(input.source).toContain(`:label="t('schedule:menu.open', 'Открыть')"`)
    expect(input.source).toContain(':input="{ rowId, columnKey, value }"')
    expect(input.projection?.menus.row.items[0]).toMatchObject({
      kind: 'item',
      label: { kind: 'expression', source: 't(\'schedule:menu.open\', \'Открыть\')' },
      input: { kind: 'expression', source: '{ rowId, columnKey, value }' },
    })
  })

  it('сохраняет выражения меню, принадлежащие Source', () => {
    const source = '<template><Table><RowMenu><MenuItem action="built-in-console-log" :label="formatLabel(row)" /></RowMenu></Table></template>'
    const result = patchComponentSFCTableSource(source, {
      type: 'set-menu-item-attribute',
      menu: 'row',
      nodeIndex: 0,
      name: 'label',
      value: 'Changed',
      valueKind: 'literal',
    })

    expect(result.ok).toBe(false)
    expect(result.source).toBe(source)
    expect(result.message).toContain('Source')
  })
})
