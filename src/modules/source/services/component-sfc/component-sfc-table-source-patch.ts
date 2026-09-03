import type { RComponentDiagnostic } from '@/modules/domain/types/component/component-core.types'
import type {
  RComponentSFC_AST_ElementNode,
  RComponentSFC_AST_TemplateNode,
} from '@/modules/domain/types/component/sfc/ast.types'
import type {
  ComponentSFCInteractionTriggerProjection,
  ComponentSFCTableSourcePatch,
  ComponentSFCTableSourcePatchResult,
  ComponentSFCTableVisualCellSyntax,
  ComponentSFCTableVisualCellTag,
  ComponentSFCTableVisualMenuKind,
  ComponentSFCVisualInspectionOptions,
} from '@/modules/domain/types/component/sfc/visual-projection.types'

import { compileComponentSFC } from '@/modules/compiler/services/component-sfc/component-sfc-compile'
import {
  compileComponentSFCExpression,
  readComponentSFCTranslationFallback,
} from '@/modules/compiler/services/component-sfc/component-sfc-expression'
import { isComponentSFCBuiltInTag } from '@/modules/compiler/services/component-sfc/component-sfc-template'
import { inspectComponentSFCVisual } from '@/modules/source/services/component-sfc/component-sfc-visual-projection'

interface TableSourceContext {
  table: RComponentSFC_AST_ElementNode
  columns: RComponentSFC_AST_ElementNode[]
  menus: Partial<Record<ComponentSFCTableVisualMenuKind, RComponentSFC_AST_ElementNode>>
  diagnostics: RComponentDiagnostic[]
}

const NON_VISUAL_CELL_TAGS = new Set([
  'Component',
  'Table',
  'Column',
  'Cell',
  'ColumnMenu',
  'CellMenu',
  'RowMenu',
  'MenuItem',
  'MenuSeparator',
  'Editable',
  'Variant',
])

const EDITABLE_PRIMITIVE_TAGS = new Set(['Text', 'Number', 'DateTime'])

/** Применяет одну узкую visual-editor операцию, не перепечатывая остальной SFC source. */
export function patchComponentSFCTableSource(
  source: string,
  patch: ComponentSFCTableSourcePatch,
  options: ComponentSFCVisualInspectionOptions = {},
): ComponentSFCTableSourcePatchResult {
  const context = resolveTableContext(source)
  if (!context) {
    const inspection = inspectComponentSFCVisual(source, options)
    return {
      ok: false,
      source,
      changed: false,
      projection: inspection.projection,
      diagnostics: inspection.diagnostics,
      message: 'Visual Table patch требует один корневой тег Table.',
    }
  }

  try {
    const nextSource = applyTablePatch(source, context, patch)
    const inspection = inspectComponentSFCVisual(nextSource, options)
    if (inspection.support.kind !== 'table' || !inspection.projection) {
      const firstError = inspection.diagnostics.find(diagnostic => diagnostic.severity === 'error')
      return {
        ok: false,
        source,
        changed: false,
        projection: null,
        diagnostics: inspection.diagnostics,
        message: patch.type === 'set-column-cell-on'
          ? `Некорректный :on: ${firstError?.message ?? 'выражение нарушило структуру template.'}`
          : patch.type === 'set-column-cell-edited-reaction'
            ? `Некорректный @edited: ${firstError?.message ?? 'reaction нарушила структуру template.'}`
            : patch.type === 'set-column-cell-editable'
              || patch.type === 'set-column-cell-edit-triggers'
              || patch.type === 'set-column-cell-cancel-triggers'
              || patch.type === 'set-column-cell-commit-triggers'
              || patch.type === 'set-column-cell-editor-component'
              || patch.type === 'set-column-cell-editor-tag'
              || patch.type === 'set-column-cell-editor-attribute'
              ? `Некорректный editable: ${firstError?.message ?? 'изменение нарушило структуру template.'}`
              : 'Изменение нарушило структуру корневого Table.',
      }
    }
    if (patch.type === 'set-column-cell-on') {
      const interactionError = inspection.diagnostics.find(diagnostic => (
        diagnostic.severity === 'error'
        && (diagnostic.code.startsWith('sfc-template-on') || diagnostic.sourcePath === 'template.on')
      ))
      if (interactionError) {
        return {
          ok: false,
          source,
          changed: false,
          projection: inspectComponentSFCVisual(source, options).projection,
          diagnostics: inspection.diagnostics,
          message: interactionError.message,
        }
      }
    }
    if (patch.type === 'set-column-cell-editable'
      || patch.type === 'set-column-cell-edit-triggers'
      || patch.type === 'set-column-cell-cancel-triggers'
      || patch.type === 'set-column-cell-commit-triggers'
      || patch.type === 'set-column-cell-editor-component'
      || patch.type === 'set-column-cell-editor-tag'
      || patch.type === 'set-column-cell-editor-attribute') {
      const editableError = inspection.diagnostics.find(diagnostic => (
        diagnostic.severity === 'error'
        && (diagnostic.code.startsWith('sfc-editable')
          || diagnostic.code.startsWith('sfc-edit-on')
          || diagnostic.code.startsWith('sfc-cancel-on')
          || diagnostic.code.startsWith('sfc-commit-on'))
      ))
      if (editableError) {
        return {
          ok: false,
          source,
          changed: false,
          projection: inspectComponentSFCVisual(source, options).projection,
          diagnostics: inspection.diagnostics,
          message: editableError.message,
        }
      }
    }
    if (patch.type === 'set-column-cell-edited-reaction') {
      const reactionError = inspection.diagnostics.find(diagnostic => (
        diagnostic.severity === 'error'
        && diagnostic.sourcePath === 'template.on.edited'
      ))
      if (reactionError) {
        return {
          ok: false,
          source,
          changed: false,
          projection: inspectComponentSFCVisual(source, options).projection,
          diagnostics: inspection.diagnostics,
          message: reactionError.message,
        }
      }
    }

    return {
      ok: true,
      source: nextSource,
      changed: nextSource !== source,
      projection: inspection.projection,
      diagnostics: inspection.diagnostics,
    }
  }
  catch (error) {
    return {
      ok: false,
      source,
      changed: false,
      projection: inspectComponentSFCVisual(source, options).projection,
      diagnostics: context.diagnostics,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

function applyTablePatch(
  source: string,
  context: TableSourceContext,
  patch: ComponentSFCTableSourcePatch,
): string {
  switch (patch.type) {
    case 'add-column':
      return addColumn(source, context, patch.key, patch.title)
    case 'remove-column':
      return removeNode(source, requireColumn(context, patch.columnIndex))
    case 'move-column':
      return moveColumn(source, context, patch.fromIndex, patch.toIndex)
    case 'set-column-attribute':
      return setNodeAttribute(
        source,
        requireColumn(context, patch.columnIndex),
        patch.name,
        patch.value,
      )
    case 'set-table-attribute':
      return setNodeAttribute(
        source,
        context.table,
        patch.name,
        patch.value,
      )
    case 'set-column-component':
      return setColumnComponent(
        source,
        requireColumn(context, patch.columnIndex),
        patch.identity,
        patch.syntax,
      )
    case 'set-column-tag':
      return setColumnTag(
        source,
        requireColumn(context, patch.columnIndex),
        patch.tag,
        patch.syntax,
      )
    case 'set-column-cell-attribute':
      return setColumnCellAttribute(
        source,
        requireColumn(context, patch.columnIndex),
        patch.name,
        patch.value,
        patch.valueKind,
      )
    case 'set-column-cell-on':
      return setColumnCellOn(
        source,
        requireColumn(context, patch.columnIndex),
        patch.value,
      )
    case 'set-column-cell-editable':
      return setColumnCellEditable(
        source,
        requireColumn(context, patch.columnIndex),
        patch.enabled,
      )
    case 'set-column-cell-edit-triggers':
      return setColumnCellEditTriggers(
        source,
        requireColumn(context, patch.columnIndex),
        patch.triggers,
      )
    case 'set-column-cell-cancel-triggers':
      return setColumnCellOutcomeTriggers(
        source,
        requireColumn(context, patch.columnIndex),
        'cancel-on',
        patch.triggers,
      )
    case 'set-column-cell-commit-triggers':
      return setColumnCellOutcomeTriggers(
        source,
        requireColumn(context, patch.columnIndex),
        'commit-on',
        patch.triggers,
      )
    case 'set-column-cell-edited-reaction':
      return setColumnCellEditedReaction(
        source,
        requireColumn(context, patch.columnIndex),
        patch.value,
      )
    case 'set-column-cell-editor-component':
      return setColumnCellEditorComponent(
        source,
        requireColumn(context, patch.columnIndex),
        patch.identity,
      )
    case 'set-column-cell-editor-tag':
      return setColumnCellEditorTag(
        source,
        requireColumn(context, patch.columnIndex),
        patch.tag,
      )
    case 'set-column-cell-editor-attribute':
      return setColumnCellEditorAttribute(
        source,
        requireColumn(context, patch.columnIndex),
        patch.name,
        patch.value,
        patch.valueKind,
      )
    case 'set-menu-mode':
      return setMenuMode(source, context, patch.menu, patch.mode, patch.columnIndex)
    case 'add-menu-node':
      return addMenuNode(source, context, patch.menu, patch.node, patch.columnIndex)
    case 'remove-menu-node':
      return removeNode(source, requireMenuNode(context, patch.menu, patch.nodeIndex, patch.columnIndex))
    case 'move-menu-node':
      return moveMenuNode(source, context, patch.menu, patch.fromIndex, patch.toIndex, patch.columnIndex)
    case 'set-menu-item-attribute':
      return setMenuItemAttribute(source, context, patch.menu, patch.nodeIndex, patch.name, patch.value, patch.valueKind, patch.columnIndex)
  }
}

function resolveTableContext(source: string): TableSourceContext | null {
  const result = compileComponentSFC(source)
  const roots = result.ast?.template?.roots.filter(isSemanticNode) ?? []
  if (roots.length !== 1 || roots[0].kind !== 'element' || roots[0].tag !== 'Table') {
    return null
  }

  return {
    table: roots[0],
    columns: roots[0].children.filter(
      (node): node is RComponentSFC_AST_ElementNode => node.kind === 'element' && node.tag === 'Column',
    ),
    menus: resolveTableMenus(roots[0]),
    diagnostics: result.diagnostics,
  }
}

function resolveTableMenus(table: RComponentSFC_AST_ElementNode): TableSourceContext['menus'] {
  const children = table.children.filter(
    (node): node is RComponentSFC_AST_ElementNode => node.kind === 'element',
  )
  const column = children.find(node => node.tag === 'ColumnMenu')
  const row = children.find(node => node.tag === 'CellMenu')
    ?? children.find(node => node.tag === 'RowMenu')
  return {
    ...(column ? { column } : {}),
    ...(row ? { row } : {}),
  }
}

function requireMenu(
  context: TableSourceContext,
  kind: ComponentSFCTableVisualMenuKind,
  columnIndex?: number,
): RComponentSFC_AST_ElementNode {
  const owner = columnIndex == null ? context.table : requireColumn(context, columnIndex)
  if (columnIndex != null && kind !== 'row') {
    throw new Error('На уровне Column поддерживается только CellMenu.')
  }
  const menu = columnIndex == null
    ? context.menus[kind]
    : owner.children.find((node): node is RComponentSFC_AST_ElementNode => node.kind === 'element' && node.tag === 'CellMenu')
  if (!menu) {
    throw new Error(`${kind === 'column' ? 'ColumnMenu' : 'CellMenu'} не найден.`)
  }
  return menu
}

function menuNodes(menu: RComponentSFC_AST_ElementNode): RComponentSFC_AST_ElementNode[] {
  return menu.children.filter(
    (node): node is RComponentSFC_AST_ElementNode => node.kind === 'element' && (node.tag === 'MenuItem' || node.tag === 'MenuSeparator'),
  )
}

function requireMenuNode(
  context: TableSourceContext,
  kind: ComponentSFCTableVisualMenuKind,
  index: number,
  columnIndex?: number,
): RComponentSFC_AST_ElementNode {
  const node = menuNodes(requireMenu(context, kind, columnIndex))[index]
  if (!node) {
    throw new Error(`Пункт меню с индексом ${index} не найден.`)
  }
  return node
}

function assertManagedMenu(source: string, menu: RComponentSFC_AST_ElementNode): void {
  if (source.slice(menu.range.start, menu.range.end).includes('<!--')) {
    throw new Error('Меню содержит комментарии и управляется во вкладке Source.')
  }
  if (menu.children.some(node => node.kind === 'element' && node.tag !== 'MenuItem' && node.tag !== 'MenuSeparator')) {
    throw new Error('Меню содержит неизвестные конструкции и управляется во вкладке Source.')
  }
}

function setMenuMode(
  source: string,
  context: TableSourceContext,
  kind: ComponentSFCTableVisualMenuKind,
  mode: 'default' | 'disabled' | 'none' | 'custom',
  columnIndex?: number,
): string {
  const owner = columnIndex == null ? context.table : requireColumn(context, columnIndex)
  if (columnIndex != null && kind !== 'row') {
    throw new Error('На уровне Column поддерживается только CellMenu.')
  }
  const menu = columnIndex == null
    ? context.menus[kind]
    : owner.children.find((node): node is RComponentSFC_AST_ElementNode => node.kind === 'element' && node.tag === 'CellMenu')
  if (menu) {
    assertManagedMenu(source, menu)
  }
  if (kind === 'column') {
    if (mode === 'none') {
      throw new Error('ColumnMenu поддерживает режимы default, custom и disabled.')
    }
    if (mode === 'custom') {
      const withMenu = menu ? source : insertChild(source, context.table, '<ColumnMenu></ColumnMenu>')
      return setNodeAttribute(withMenu, context.table, 'column-menu', null)
    }
    const withoutMenu = menu ? removeNode(source, menu) : source
    return setNodeAttribute(withoutMenu, context.table, 'column-menu', mode === 'disabled' ? 'disabled' : null)
  }
  if (columnIndex != null) {
    if (mode === 'disabled') {
      throw new Error('Column CellMenu поддерживает inherit, custom и none.')
    }
    const withoutMenu = menu ? removeNode(source, menu) : source
    if (mode === 'default') {
      return setNodeAttribute(withoutMenu, owner, 'cell-menu', null)
    }
    if (mode === 'none') {
      return setNodeAttribute(withoutMenu, owner, 'cell-menu', 'none')
    }
    const withoutMode = setNodeAttribute(source, owner, 'cell-menu', null)
    return menu ? withoutMode : insertChild(withoutMode, owner, '<CellMenu></CellMenu>')
  }
  if (mode === 'default' || mode === 'disabled') {
    throw new Error('CellMenu поддерживает режимы none и custom.')
  }
  if (mode === 'none') {
    return menu ? removeNode(source, menu) : source
  }
  return menu ? source : insertChild(source, context.table, '<CellMenu></CellMenu>')
}

function addMenuNode(
  source: string,
  context: TableSourceContext,
  kind: ComponentSFCTableVisualMenuKind,
  node: 'item' | 'separator',
  columnIndex?: number,
): string {
  const menu = requireMenu(context, kind, columnIndex)
  assertManagedMenu(source, menu)
  const markup = node === 'separator'
    ? '<MenuSeparator />'
    : '<MenuItem action="built-in-console-log" label="Новый пункт" />'
  return insertChild(source, menu, markup)
}

function moveMenuNode(
  source: string,
  context: TableSourceContext,
  kind: ComponentSFCTableVisualMenuKind,
  fromIndex: number,
  toIndex: number,
  columnIndex?: number,
): string {
  const menu = requireMenu(context, kind, columnIndex)
  assertManagedMenu(source, menu)
  const nodes = menuNodes(menu)
  if (!nodes[fromIndex] || !nodes[toIndex]) {
    throw new Error('Пункт меню не найден.')
  }
  if (fromIndex === toIndex) {
    return source
  }
  const fragments = nodes.map(node => source.slice(node.range.start, node.range.end))
  const [moved] = fragments.splice(fromIndex, 1)
  fragments.splice(toIndex, 0, moved!)
  return nodes.map((node, index) => ({ start: node.range.start, end: node.range.end, value: fragments[index]! }))
    .sort((left, right) => right.start - left.start)
    .reduce((next, replacement) => replaceRange(next, replacement.start, replacement.end, replacement.value), source)
}

function setMenuItemAttribute(
  source: string,
  context: TableSourceContext,
  kind: ComponentSFCTableVisualMenuKind,
  nodeIndex: number,
  name: 'label' | 'action' | 'input' | 'icon' | 'visible' | 'disabled',
  value: string | null,
  valueKind: 'expression' | 'literal',
  columnIndex?: number,
): string {
  const menu = requireMenu(context, kind, columnIndex)
  assertManagedMenu(source, menu)
  const item = requireMenuNode(context, kind, nodeIndex, columnIndex)
  if (item.tag !== 'MenuItem') {
    throw new Error('MenuSeparator не содержит attributes.')
  }
  if (source.slice(item.range.start, item.range.end).includes('<!--')) {
    throw new Error('Пункт меню управляется во вкладке Source.')
  }
  const actionAttribute = item.attributes.find(attribute => attribute.name === 'action')
  const labelAttribute = item.attributes.find(attribute => attribute.name === 'label')
  if (actionAttribute?.dynamic) {
    throw new Error('Legacy :action object управляется во вкладке Source.')
  }
  if (labelAttribute?.dynamic && readComponentSFCTranslationFallback(labelAttribute.value ?? '') == null) {
    throw new Error('Неизвестное label expression управляется во вкладке Source.')
  }
  if (item.attributes.some(attribute => !['id', 'label', 'action', 'input', 'icon', 'disabled'].includes(attribute.name))
    || item.directives.some(directive => directive.name !== 'if')) {
    throw new Error('Пункт меню содержит неизвестные конструкции и управляется во вкладке Source.')
  }
  if (name === 'action' && valueKind !== 'literal') {
    throw new Error('Visual editor поддерживает literal action="...". Legacy :action object остаётся Source-owned.')
  }
  if (valueKind === 'expression' && value) {
    const result = compileComponentSFCExpression(value, {
      locals: kind === 'row'
        ? ['$table', '$row', '$column', '$cell', 'row', 'rowId', 'rowIndex', 'columnKey', 'columnMeta', 'value']
        : ['$table', '$column'],
      sourcePath: `template.Table.${kind === 'row' ? 'CellMenu' : 'ColumnMenu'}.MenuItem.${name}`,
    })
    const error = result.diagnostics.find(item => item.severity === 'error')
    if (error) {
      throw new Error(error.message)
    }
  }
  if (name === 'visible') {
    if (valueKind !== 'expression' && value) {
      throw new Error('Условие видимости должно быть expression.')
    }
    return setNodeDirectiveExpression(source, item, 'if', value)
  }
  return setNodeAttributeValue(source, item, name, value, valueKind)
}

function isSemanticNode(node: RComponentSFC_AST_TemplateNode): boolean {
  return node.kind !== 'text' || Boolean(node.content.trim())
}

function requireColumn(context: TableSourceContext, index: number): RComponentSFC_AST_ElementNode {
  const column = context.columns[index]
  if (!column) {
    throw new Error(`Column с индексом ${index} не найден.`)
  }
  return column
}

function addColumn(
  source: string,
  context: TableSourceContext,
  requestedKey?: string,
  requestedTitle?: string,
): string {
  const key = requestedKey?.trim() || nextColumnKey(source, context)
  const title = requestedTitle ?? 'Новая колонка'
  const markup = `<Column key="${escapeAttribute(key)}" title="${escapeAttribute(title)}" />`
  return insertChild(source, context.table, markup)
}

function nextColumnKey(source: string, context: TableSourceContext): string {
  const used = new Set(context.columns.map((column) => {
    const declaration = [...column.attributes, ...column.directives]
      .find(item => item.name === 'key')
    return declaration
      ? source.slice(declaration.range.start, declaration.range.end).replace(/^.*?=["']?|["']$/g, '').trim()
      : ''
  }))
  let index = context.columns.length + 1
  while (used.has(`column_${index}`)) {
    index += 1
  }
  return `column_${index}`
}

function moveColumn(
  source: string,
  context: TableSourceContext,
  fromIndex: number,
  toIndex: number,
): string {
  requireColumn(context, fromIndex)
  requireColumn(context, toIndex)
  if (fromIndex === toIndex) {
    return source
  }

  const fragments = context.columns.map(column => source.slice(column.range.start, column.range.end))
  const [moved] = fragments.splice(fromIndex, 1)
  fragments.splice(toIndex, 0, moved)

  return context.columns
    .map((column, index) => ({
      start: column.range.start,
      end: column.range.end,
      value: fragments[index],
    }))
    .sort((left, right) => right.start - left.start)
    .reduce(
      (nextSource, replacement) => replaceRange(nextSource, replacement.start, replacement.end, replacement.value),
      source,
    )
}

function setColumnComponent(
  source: string,
  column: RComponentSFC_AST_ElementNode,
  rawIdentity: string | null,
  syntax: ComponentSFCTableVisualCellSyntax | undefined,
): string {
  const identity = rawIdentity?.trim() || null
  if (syntax === 'editable-default') {
    if (!identity) {
      throw new Error('Variant default требует Component или Tag.')
    }
    return replaceEditableVariantElement(source, column, 'default', componentMarkup(identity))
  }
  const cell = column.children.find(
    (node): node is RComponentSFC_AST_ElementNode => node.kind === 'element' && node.tag === 'Cell',
  ) ?? null

  if (!cell) {
    const directChildren = column.children.filter(isSemanticNode)
    if (directChildren.length > 0 && syntax !== 'direct') {
      throw new Error('Колонка содержит прямой компонент или произвольный Source. Измените её во вкладке Source.')
    }
    if (directChildren.length > 0) {
      return setDirectColumnComponent(source, column, directChildren, identity)
    }
    if (!identity) {
      return source
    }
    return insertChild(source, column, componentCellMarkup(identity))
  }

  if (source.slice(cell.range.start, cell.range.end).includes('<!--')) {
    throw new Error('Ячейка содержит комментарии или произвольный Source. Измените её во вкладке Source.')
  }

  const semanticChildren = cell.children.filter(isSemanticNode)
  const component = semanticChildren.length === 1
    && semanticChildren[0].kind === 'element'
    && semanticChildren[0].tag === 'Component'
    ? semanticChildren[0]
    : null
  const managedTag = semanticChildren.length === 1
    && semanticChildren[0].kind === 'element'
    && isVisualCellTag(semanticChildren[0].tag)
    ? semanticChildren[0]
    : null
  const isEmptyManagedCell = semanticChildren.length === 0

  if (!component && !managedTag && !isEmptyManagedCell) {
    throw new Error('Ячейка содержит произвольный Source. Измените её во вкладке Source.')
  }

  if (!identity) {
    return removeNode(source, cell)
  }
  if (managedTag) {
    return replaceRange(source, managedTag.range.start, managedTag.range.end, `<Component is="${escapeAttribute(identity)}" />`)
  }
  if (!component) {
    return insertChild(source, cell, `<Component is="${escapeAttribute(identity)}" />`)
  }

  return setNodeAttribute(source, component, 'is', identity)
}

function setColumnTag(
  source: string,
  column: RComponentSFC_AST_ElementNode,
  tag: ComponentSFCTableVisualCellTag | null,
  syntax: ComponentSFCTableVisualCellSyntax | undefined,
): string {
  if (tag && !isVisualCellTag(tag)) {
    throw new Error(`Tag ${tag} нельзя использовать как простой Table Cell.`)
  }
  if (syntax === 'editable-default') {
    if (!tag) {
      throw new Error('Variant default требует Component или Tag.')
    }
    return replaceEditableVariantElement(source, column, 'default', tagMarkup(tag))
  }

  const cell = column.children.find(
    (node): node is RComponentSFC_AST_ElementNode => node.kind === 'element' && node.tag === 'Cell',
  ) ?? null

  if (!cell) {
    const directChildren = column.children.filter(isSemanticNode)
    if (directChildren.length === 0) {
      return tag ? insertChild(source, column, tagCellMarkup(tag)) : source
    }
    if (syntax !== 'direct' || directChildren.length !== 1 || directChildren[0].kind !== 'element') {
      throw new Error('Колонка содержит произвольный Source. Измените её во вкладке Source.')
    }
    if (source.slice(column.range.start, column.range.end).includes('<!--')) {
      throw new Error('Колонка содержит комментарии или произвольный Source. Измените её во вкладке Source.')
    }
    if (!tag) {
      return removeNode(source, directChildren[0])
    }
    if (isVisualCellTag(directChildren[0].tag)) {
      return directChildren[0].tag === tag
        ? source
        : replaceRange(source, directChildren[0].range.start, directChildren[0].range.end, tagMarkup(tag))
    }
    return replaceRange(source, directChildren[0].range.start, directChildren[0].range.end, tagMarkup(tag))
  }

  if (source.slice(cell.range.start, cell.range.end).includes('<!--')) {
    throw new Error('Ячейка содержит комментарии или произвольный Source. Измените её во вкладке Source.')
  }

  const semanticChildren = cell.children.filter(isSemanticNode)
  if (semanticChildren.length === 0) {
    if (!tag) {
      return removeNode(source, cell)
    }
    return insertChild(source, cell, tagMarkup(tag))
  }

  const child = semanticChildren.length === 1 && semanticChildren[0].kind === 'element'
    ? semanticChildren[0]
    : null
  if (!child || (child.tag !== 'Component' && !isVisualCellTag(child.tag))) {
    throw new Error('Ячейка содержит произвольный Source. Измените её во вкладке Source.')
  }
  if (!tag) {
    return removeNode(source, cell)
  }
  if (isVisualCellTag(child.tag)) {
    return child.tag === tag
      ? source
      : replaceRange(source, child.range.start, child.range.end, tagMarkup(tag))
  }
  return replaceRange(source, child.range.start, child.range.end, tagMarkup(tag))
}

function setDirectColumnComponent(
  source: string,
  column: RComponentSFC_AST_ElementNode,
  children: RComponentSFC_AST_TemplateNode[],
  identity: string | null,
): string {
  const component = children.length === 1 && children[0].kind === 'element'
    ? children[0]
    : null
  if (!component || source.slice(column.range.start, column.range.end).includes('<!--')) {
    throw new Error('Колонка содержит произвольный Source. Измените её во вкладке Source.')
  }

  if (!identity) {
    return removeNode(source, component)
  }
  if (component.tag === 'Component') {
    return setNodeAttribute(source, component, 'is', identity)
  }

  const hasReservedIs = component.attributes.some(attribute => attribute.name === 'is')
    || component.directives.some(directive => directive.name === 'bind' && directive.argument === 'is')
  if (hasReservedIs) {
    throw new Error('Direct component содержит зарезервированный attribute is. Измените его во вкладке Source.')
  }

  const normalizedSource = renameElementTag(source, component, 'Component')
  return insertAttribute(normalizedSource, component, serializeAttribute('is', identity))
}

function setColumnCellAttribute(
  source: string,
  column: RComponentSFC_AST_ElementNode,
  rawName: string,
  value: string | null,
  valueKind: 'expression' | 'literal',
): string {
  const name = rawName.trim()
  if (!/^[A-Z_$][\w$.-]*$/i.test(name)) {
    throw new Error(`Некорректное имя входного параметра "${rawName}".`)
  }
  if (name === 'is') {
    throw new Error('Параметр is управляется выбором компонента.')
  }

  const child = requireManagedColumnCellElement(source, column)
  if (valueKind === 'expression' && value != null) {
    const result = compileComponentSFCExpression(value, {
      sourcePath: `template.Table.Column.${name}`,
    })
    const error = result.diagnostics.find(item => item.severity === 'error')
    if (error) {
      throw new Error(error.message)
    }
  }

  return setNodeAttributeValue(source, child, name, value, valueKind)
}

function setColumnCellOn(
  source: string,
  column: RComponentSFC_AST_ElementNode,
  rawValue: string | null,
): string {
  const value = rawValue?.trim() || null
  const cell = column.children.find(
    (node): node is RComponentSFC_AST_ElementNode => node.kind === 'element' && node.tag === 'Cell',
  ) ?? null

  if (cell) {
    const declarations = cell.attributes.filter(attribute => attribute.name === 'on')
    if (declarations.length > 1) {
      throw new Error(':on объявлен на Cell несколько раз. Измените его во вкладке Source.')
    }
    const declaration = declarations[0] ?? null
    if (!value) {
      return declaration ? removeRangeWithWhitespace(source, declaration.range.start, declaration.range.end) : source
    }
    if (declaration) {
      const suffix = declaration.modifiers.map(modifier => `.${modifier}`).join('')
      return replaceRange(
        source,
        declaration.range.start,
        declaration.range.end,
        serializeAttributeValue(`on${suffix}`, value, 'expression'),
      )
    }
    return insertAttribute(source, cell, serializeAttributeValue('on', value, 'expression'))
  }

  if (!value) {
    return source
  }
  const attribute = serializeAttributeValue('on', value, 'expression')
  const children = column.children.filter(isSemanticNode)
  if (children.length === 0) {
    return insertChild(source, column, `<Cell ${attribute}>{{ value }}</Cell>`)
  }

  const first = children[0]!
  const last = children.at(-1)!
  const indent = lineIndent(source, first.range.start)
  const original = source.slice(first.range.start, last.range.end)
  return replaceRange(
    source,
    first.range.start,
    last.range.end,
    `<Cell ${attribute}>\n${indent}  ${original}\n${indent}</Cell>`,
  )
}

function setColumnCellEditable(
  source: string,
  column: RComponentSFC_AST_ElementNode,
  enabled: boolean,
): string {
  const node = requireColumnCellRootElement(source, column)
  if (node.tag === 'Editable') {
    if (enabled) {
      return source
    }
    const structure = requireCanonicalEditableStructure(source, node)
    return replaceRange(
      source,
      node.range.start,
      node.range.end,
      unwrapCompositeEditable(source, structure),
    )
  }
  if (!EDITABLE_PRIMITIVE_TAGS.has(node.tag)) {
    throw new Error('Встроенный visual editor поддерживает editable только для Text, Number и DateTime.')
  }
  if (enabled) {
    return setStaticBooleanAttribute(source, node, 'editable', true)
  }

  // Удаляем с конца, чтобы первая правка не сдвигала диапазоны следующей.
  const declarations = [
    ...node.attributes.filter(attribute => (
      attribute.name === 'editable'
      || attribute.name === 'edit-on'
      || attribute.name === 'cancel-on'
      || attribute.name === 'commit-on'
    )),
    ...node.directives.filter(directive => directive.name === 'on' && directive.argument?.trim() === 'edited'),
  ]
    .sort((left, right) => right.range.start - left.range.start)
  return declarations.reduce(
    (nextSource, declaration) => removeRangeWithWhitespace(nextSource, declaration.range.start, declaration.range.end),
    source,
  )
}

function setColumnCellEditTriggers(
  source: string,
  column: RComponentSFC_AST_ElementNode,
  triggers: ComponentSFCInteractionTriggerProjection[],
): string {
  const node = requireEditableBehaviorElement(source, column)

  const declarations = node.attributes.filter(attribute => attribute.name === 'edit-on')
  if (declarations.length > 1) {
    throw new Error('edit-on объявлен несколько раз. Измените его во вкладке Source.')
  }
  const declaration = declarations[0] ?? null
  if (!triggers.length) {
    return declaration
      ? removeRangeWithWhitespace(source, declaration.range.start, declaration.range.end)
      : source
  }

  for (const trigger of triggers) {
    if (!trigger.event.trim()) {
      throw new Error('Trigger входа в редактирование требует непустое событие.')
    }
    if (trigger.flags.prevent && trigger.flags.passive) {
      throw new Error('Trigger не может одновременно использовать prevent и passive.')
    }
  }

  const suffix = declaration?.modifiers.map(modifier => `.${modifier}`).join('') ?? ''
  const attribute = !suffix && triggers.length === 1 && isPlainInteractionTrigger(triggers[0]!)
    ? serializeAttribute(`edit-on${suffix}`, triggers[0]!.event.trim())
    : serializeAttributeValue(
        `edit-on${suffix}`,
        triggers.length === 1
          ? serializeInteractionTrigger(triggers[0]!)
          : `[${triggers.map(serializeInteractionTrigger).join(', ')}]`,
        'expression',
      )

  if (declaration) {
    return replaceRange(source, declaration.range.start, declaration.range.end, attribute)
  }
  return insertAttribute(source, node, attribute)
}

function setColumnCellOutcomeTriggers(
  source: string,
  column: RComponentSFC_AST_ElementNode,
  name: 'cancel-on' | 'commit-on',
  triggers: ComponentSFCInteractionTriggerProjection[] | null,
): string {
  const node = requireEditableBehaviorElement(source, column)
  const declarations = node.attributes.filter(attribute => attribute.name === name)
  if (declarations.length > 1) {
    throw new Error(`${name} объявлен несколько раз. Измените его во вкладке Source.`)
  }
  const declaration = declarations[0] ?? null
  if (triggers == null) {
    return declaration
      ? removeRangeWithWhitespace(source, declaration.range.start, declaration.range.end)
      : source
  }
  for (const trigger of triggers) {
    if (!trigger.event.trim()) {
      throw new Error(`${name} требует непустое событие.`)
    }
    if (trigger.flags.prevent && trigger.flags.passive) {
      throw new Error(`${name} trigger не может одновременно использовать prevent и passive.`)
    }
  }
  const suffix = declaration?.modifiers.map(modifier => `.${modifier}`).join('') ?? ''
  const attribute = triggers.length === 0
    ? serializeAttributeValue(name, '[]', 'expression')
    : !suffix && triggers.length === 1 && isPlainInteractionTrigger(triggers[0]!)
        ? serializeAttribute(name, triggers[0]!.event.trim())
        : serializeAttributeValue(
            `${name}${suffix}`,
            triggers.length === 1
              ? serializeInteractionTrigger(triggers[0]!)
              : `[${triggers.map(serializeInteractionTrigger).join(', ')}]`,
            'expression',
          )
  return declaration
    ? replaceRange(source, declaration.range.start, declaration.range.end, attribute)
    : insertAttribute(source, node, attribute)
}

function setColumnCellEditedReaction(
  source: string,
  column: RComponentSFC_AST_ElementNode,
  rawValue: string | null,
): string {
  const node = requireEditableBehaviorElement(source, column)

  const declarations = node.directives.filter(
    directive => directive.name === 'on' && directive.argument?.trim() === 'edited',
  )
  if (declarations.length > 1) {
    throw new Error('@edited объявлен несколько раз. Измените его во вкладке Source.')
  }
  const declaration = declarations[0] ?? null
  const value = rawValue?.trim() || null
  if (!value) {
    return declaration
      ? removeRangeWithWhitespace(source, declaration.range.start, declaration.range.end)
      : source
  }

  const suffix = declaration?.modifiers.map(modifier => `.${modifier}`).join('') ?? ''
  const attribute = `@edited${suffix}="${escapeAttribute(value)}"`
  return declaration
    ? replaceRange(source, declaration.range.start, declaration.range.end, attribute)
    : insertAttribute(source, node, attribute)
}

function requireEditableBehaviorElement(
  source: string,
  column: RComponentSFC_AST_ElementNode,
): RComponentSFC_AST_ElementNode {
  const node = requireColumnCellRootElement(source, column)
  if (node.tag === 'Editable') {
    requireCanonicalEditableStructure(source, node)
    return node
  }
  if (!EDITABLE_PRIMITIVE_TAGS.has(node.tag)) {
    throw new Error('Встроенный visual editor поддерживает editable только для Text, Number и DateTime.')
  }
  const editable = node.attributes.find(attribute => attribute.name === 'editable') ?? null
  if (!editable || editable.dynamic || editable.value != null) {
    throw new Error('Сначала включите статический editable для выбранного элемента.')
  }
  return node
}

function setColumnCellEditorComponent(
  source: string,
  column: RComponentSFC_AST_ElementNode,
  rawIdentity: string,
): string {
  const identity = rawIdentity.trim()
  if (!identity) {
    throw new Error('Выберите Component для editor-варианта.')
  }
  return setColumnCellEditorMarkup(source, column, componentMarkup(identity))
}

function setColumnCellEditorTag(
  source: string,
  column: RComponentSFC_AST_ElementNode,
  tag: ComponentSFCTableVisualCellTag,
): string {
  if (!isVisualCellTag(tag)) {
    throw new Error(`Tag ${tag} нельзя использовать как editor-вариант.`)
  }
  const root = requireColumnCellRootElement(source, column)
  if (root.tag === 'Editable') {
    const structure = requireCanonicalEditableStructure(source, root)
    if (supportsIntrinsicEditor(structure.defaultChild, tag)) {
      const intrinsic = collapseCompositeEditable(source, structure)
      if (intrinsic) {
        return replaceRange(source, root.range.start, root.range.end, intrinsic)
      }
    }
    return replaceEditableVariantElement(source, column, 'edit', tagMarkup(tag))
  }
  if (supportsIntrinsicEditor(root, tag)) {
    return setStaticBooleanAttribute(source, root, 'editable', true)
  }
  return setColumnCellEditorMarkup(source, column, tagMarkup(tag))
}

function setColumnCellEditorMarkup(
  source: string,
  column: RComponentSFC_AST_ElementNode,
  markup: string,
): string {
  const root = requireColumnCellRootElement(source, column)
  if (root.tag === 'Editable') {
    return replaceEditableVariantElement(source, column, 'edit', markup)
  }
  return convertElementToCompositeEditable(source, root, markup)
}

function setColumnCellEditorAttribute(
  source: string,
  column: RComponentSFC_AST_ElementNode,
  rawName: string,
  value: string | null,
  valueKind: 'expression' | 'literal',
): string {
  const name = rawName.trim()
  if (!/^[A-Z_$][\w$.-]*$/i.test(name)) {
    throw new Error(`Некорректное имя входного параметра "${rawName}".`)
  }
  if (name === 'is') {
    throw new Error('Параметр is управляется выбором компонента.')
  }
  if (valueKind === 'expression' && value != null) {
    const result = compileComponentSFCExpression(value, {
      sourcePath: `template.Table.Column.Editable.Variant.edit.${name}`,
    })
    const error = result.diagnostics.find(item => item.severity === 'error')
    if (error) {
      throw new Error(error.message)
    }
  }
  const root = requireColumnCellRootElement(source, column)
  if (root.tag !== 'Editable') {
    throw new Error('Сначала выберите отдельный editor; встроенный editor использует параметры отображения.')
  }
  const structure = requireCanonicalEditableStructure(source, root)
  return setNodeAttributeValue(source, structure.editChild, name, value, valueKind)
}

function setStaticBooleanAttribute(
  source: string,
  node: RComponentSFC_AST_ElementNode,
  name: string,
  enabled: boolean,
): string {
  const declarations = node.attributes.filter(attribute => attribute.name === name)
  if (declarations.length > 1) {
    throw new Error(`${name} объявлен несколько раз. Измените его во вкладке Source.`)
  }
  const declaration = declarations[0] ?? null
  if (declaration && (declaration.dynamic || declaration.value != null)) {
    throw new Error(`${name} должен быть статическим boolean-атрибутом.`)
  }
  if (enabled) {
    return declaration ? source : insertAttribute(source, node, name)
  }
  return declaration
    ? removeRangeWithWhitespace(source, declaration.range.start, declaration.range.end)
    : source
}

function isPlainInteractionTrigger(trigger: ComponentSFCInteractionTriggerProjection): boolean {
  return !trigger.key.length
    && !trigger.code.length
    && !trigger.held
    && Object.keys(trigger.modifiers).length === 0
    && trigger.repeat == null
    && trigger.composing == null
    && trigger.button == null
    && !Object.values(trigger.flags).some(value => value != null)
}

function serializeInteractionTrigger(trigger: ComponentSFCInteractionTriggerProjection): string {
  const fields = [`event: ${quoteExpressionString(trigger.event.trim())}`]
  if (trigger.key.length) {
    fields.push(`key: ${serializeExpressionStringList(trigger.key)}`)
  }
  if (trigger.code.length) {
    fields.push(`code: ${serializeExpressionStringList(trigger.code)}`)
  }
  if (trigger.held) {
    const held = []
    if (trigger.held.key.length) {
      held.push(`key: ${serializeExpressionStringList(trigger.held.key)}`)
    }
    if (trigger.held.code.length) {
      held.push(`code: ${serializeExpressionStringList(trigger.held.code)}`)
    }
    if (trigger.held.match === 'any') {
      held.push(`match: 'any'`)
    }
    if (trigger.held.exact) {
      held.push('exact: true')
    }
    if (held.length) {
      fields.push(`held: { ${held.join(', ')} }`)
    }
  }
  const modifiers = Object.entries(trigger.modifiers)
    .filter(([, value]) => value != null)
    .map(([name, value]) => `${name}: ${value}`)
  if (modifiers.length) {
    fields.push(`modifiers: { ${modifiers.join(', ')} }`)
  }
  if (trigger.repeat != null) {
    fields.push(`repeat: ${trigger.repeat}`)
  }
  if (trigger.composing != null) {
    fields.push(`composing: ${trigger.composing}`)
  }
  if (trigger.button != null) {
    fields.push(`button: ${trigger.button}`)
  }
  for (const flag of ['stop', 'prevent', 'self', 'once', 'capture', 'passive'] as const) {
    if (trigger.flags[flag] === true) {
      fields.push(`${flag}: true`)
    }
  }
  return `{ ${fields.join(', ')} }`
}

function serializeExpressionStringList(values: string[]): string {
  return values.length === 1
    ? quoteExpressionString(values[0]!)
    : `[${values.map(quoteExpressionString).join(', ')}]`
}

function quoteExpressionString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`
}

interface CanonicalEditableStructure {
  root: RComponentSFC_AST_ElementNode
  defaultVariant: RComponentSFC_AST_ElementNode
  defaultChild: RComponentSFC_AST_ElementNode
  editVariant: RComponentSFC_AST_ElementNode
  editChild: RComponentSFC_AST_ElementNode
}

function requireColumnCellRootElement(
  source: string,
  column: RComponentSFC_AST_ElementNode,
): RComponentSFC_AST_ElementNode {
  if (source.slice(column.range.start, column.range.end).includes('<!--')) {
    throw new Error('Колонка содержит комментарии или произвольный Source.')
  }

  const cell = column.children.find(
    (node): node is RComponentSFC_AST_ElementNode => node.kind === 'element' && node.tag === 'Cell',
  ) ?? null
  const children = (cell?.children ?? column.children).filter(isSemanticNode)
  if (children.length !== 1 || children[0].kind !== 'element') {
    throw new Error('Для visual bindings нужен один Component или Tag внутри колонки.')
  }

  return children[0]
}

function requireManagedColumnCellElement(
  source: string,
  column: RComponentSFC_AST_ElementNode,
): RComponentSFC_AST_ElementNode {
  const root = requireColumnCellRootElement(source, column)
  return root.tag === 'Editable'
    ? requireCanonicalEditableStructure(source, root).defaultChild
    : root
}

function requireCanonicalEditableStructure(
  source: string,
  root: RComponentSFC_AST_ElementNode,
): CanonicalEditableStructure {
  if (root.tag !== 'Editable') {
    throw new Error('Ожидался составной Editable.')
  }
  if (source.slice(root.range.start, root.range.end).includes('<!--')) {
    throw new Error('Editable с комментариями редактируется только во вкладке Source.')
  }
  const variants = root.children.filter(isSemanticNode)
  if (variants.length !== 2 || variants.some(node => node.kind !== 'element' || node.tag !== 'Variant')) {
    throw new Error('Editable должен содержать ровно Variant default и Variant edit.')
  }

  const resolved = new Map<string, { variant: RComponentSFC_AST_ElementNode, child: RComponentSFC_AST_ElementNode }>()
  for (const rawVariant of variants) {
    if (rawVariant.kind !== 'element') {
      continue
    }
    const names = rawVariant.attributes.filter(attribute => attribute.name === 'name')
    const name = names.length === 1 && !names[0]!.dynamic ? names[0]!.value?.trim() : null
    if (name !== 'default' && name !== 'edit') {
      throw new Error('Variant внутри Editable должен иметь статическое name="default" или name="edit".')
    }
    const children = rawVariant.children.filter(isSemanticNode)
    if (children.length !== 1 || children[0]!.kind !== 'element') {
      throw new Error(`Variant ${name} должен содержать ровно один Component или Tag.`)
    }
    if (resolved.has(name)) {
      throw new Error(`Variant ${name} объявлен несколько раз.`)
    }
    resolved.set(name, { variant: rawVariant, child: children[0]! })
  }
  const defaultVariant = resolved.get('default')
  const editVariant = resolved.get('edit')
  if (!defaultVariant || !editVariant) {
    throw new Error('Editable должен содержать Variant default и Variant edit.')
  }
  return {
    root,
    defaultVariant: defaultVariant.variant,
    defaultChild: defaultVariant.child,
    editVariant: editVariant.variant,
    editChild: editVariant.child,
  }
}

function replaceEditableVariantElement(
  source: string,
  column: RComponentSFC_AST_ElementNode,
  variant: 'default' | 'edit',
  markup: string,
): string {
  const root = requireColumnCellRootElement(source, column)
  const structure = requireCanonicalEditableStructure(source, root)
  const child = variant === 'default' ? structure.defaultChild : structure.editChild
  return replaceRange(source, child.range.start, child.range.end, markup)
}

function convertElementToCompositeEditable(
  source: string,
  root: RComponentSFC_AST_ElementNode,
  rawEditorMarkup: string,
): string {
  const editable = root.attributes.find(attribute => attribute.name === 'editable') ?? null
  if (editable && (editable.dynamic || editable.value != null)) {
    throw new Error('editable должен быть статическим boolean-атрибутом.')
  }
  if (root.directives.some(directive => (
    directive.name === 'if'
    || directive.name === 'else-if'
    || directive.name === 'else'
    || directive.name === 'for'
  ))) {
    throw new Error('Элемент со структурной директивой можно обернуть в Editable только во вкладке Source.')
  }
  const editOn = root.attributes.filter(attribute => attribute.name === 'edit-on')
  const cancelOn = root.attributes.filter(attribute => attribute.name === 'cancel-on')
  const commitOn = root.attributes.filter(attribute => attribute.name === 'commit-on')
  const edited = root.directives.filter(
    directive => directive.name === 'on' && directive.argument?.trim() === 'edited',
  )
  if (editOn.length > 1 || cancelOn.length > 1 || commitOn.length > 1 || edited.length > 1) {
    throw new Error('Дублирующиеся edit-on, cancel-on, commit-on или @edited редактируются только во вкладке Source.')
  }

  const intrinsicDisplay = EDITABLE_PRIMITIVE_TAGS.has(root.tag)
  const value = intrinsicDisplay
    ? root.attributes.find(attribute => attribute.name === 'value') ?? null
    : null
  const wrapperDeclarations = [
    value,
    editOn[0] ?? null,
    cancelOn[0] ?? null,
    commitOn[0] ?? null,
    edited[0] ?? null,
  ]
    .filter((declaration): declaration is NonNullable<typeof declaration> => Boolean(declaration))
    .map(declaration => source.slice(declaration.range.start, declaration.range.end).trim())
  if (!value) {
    wrapperDeclarations.unshift(':value="value"')
  }

  const removed = [
    editable,
    editOn[0] ?? null,
    cancelOn[0] ?? null,
    commitOn[0] ?? null,
    edited[0] ?? null,
  ]
    .filter((declaration): declaration is NonNullable<typeof declaration> => Boolean(declaration))
    .sort((left, right) => right.range.start - left.range.start)
  let displayMarkup = source.slice(root.range.start, root.range.end)
  for (const declaration of removed) {
    displayMarkup = removeRangeWithWhitespace(
      displayMarkup,
      declaration.range.start - root.range.start,
      declaration.range.end - root.range.start,
    )
  }
  displayMarkup = normalizeMarkupIndent(displayMarkup).trim()

  const valueDeclaration = value
    ? source.slice(value.range.start, value.range.end).trim()
    : ':value="value"'
  const editorMarkup = normalizeMarkupIndent(
    rawEditorMarkup.includes(':value="value"')
      ? rawEditorMarkup.replace(':value="value"', valueDeclaration)
      : rawEditorMarkup.replace(/\s*\/>$/, ` ${valueDeclaration} />`),
  ).trim()
  const baseIndent = lineIndent(source, root.range.start)
  const attributeIndent = `${baseIndent}  `
  const childIndent = `${baseIndent}    `
  const opening = `<Editable\n${wrapperDeclarations.map(declaration => indentMarkup(declaration, attributeIndent)).join('\n')}\n${baseIndent}>`
  const markup = `${opening}\n${baseIndent}  <Variant name="default">\n${indentMarkup(displayMarkup, childIndent)}\n${baseIndent}  </Variant>\n\n${baseIndent}  <Variant name="edit">\n${indentMarkup(editorMarkup, childIndent)}\n${baseIndent}  </Variant>\n${baseIndent}</Editable>`
  return replaceRange(source, root.range.start, root.range.end, markup)
}

function supportsIntrinsicEditor(
  display: RComponentSFC_AST_ElementNode,
  editorTag: ComponentSFCTableVisualCellTag,
): boolean {
  return EDITABLE_PRIMITIVE_TAGS.has(display.tag) && display.tag === editorTag
}

function unwrapCompositeEditable(
  source: string,
  structure: CanonicalEditableStructure,
): string {
  const displayMarkup = source.slice(
    structure.defaultChild.range.start,
    structure.defaultChild.range.end,
  )
  if (!EDITABLE_PRIMITIVE_TAGS.has(structure.defaultChild.tag)) {
    return displayMarkup
  }
  const value = structure.root.attributes.find(attribute => attribute.name === 'value') ?? null
  if (!value || structure.defaultChild.attributes.some(attribute => attribute.name === 'value')) {
    return displayMarkup
  }
  return insertDeclarationsIntoElementMarkup(
    source,
    structure.defaultChild,
    displayMarkup,
    [source.slice(value.range.start, value.range.end).trim()],
  )
}

function collapseCompositeEditable(
  source: string,
  structure: CanonicalEditableStructure,
): string | null {
  const allowedAttributes = new Set(['value', 'edit-on', 'cancel-on', 'commit-on'])
  if (structure.root.attributes.some(attribute => !allowedAttributes.has(attribute.name))) {
    return null
  }
  if (structure.root.directives.some(directive => (
    directive.name !== 'on' || directive.argument?.trim() !== 'edited'
  ))) {
    return null
  }

  const displayEditable = structure.defaultChild.attributes.filter(attribute => attribute.name === 'editable')
  if (displayEditable.length > 1) {
    return null
  }
  if (displayEditable[0] && (displayEditable[0].dynamic || displayEditable[0].value != null)) {
    return null
  }
  const declarations = displayEditable.length ? [] : ['editable']
  for (const name of allowedAttributes) {
    const wrapperDeclarations = structure.root.attributes.filter(attribute => attribute.name === name)
    if (wrapperDeclarations.length > 1) {
      return null
    }
    const declaration = wrapperDeclarations[0]
    if (declaration && !structure.defaultChild.attributes.some(attribute => attribute.name === name)) {
      declarations.push(source.slice(declaration.range.start, declaration.range.end).trim())
    }
  }
  const edited = structure.root.directives.filter(directive => (
    directive.name === 'on' && directive.argument?.trim() === 'edited'
  ))
  if (edited.length > 1) {
    return null
  }
  if (edited[0] && !structure.defaultChild.directives.some(directive => (
    directive.name === 'on' && directive.argument?.trim() === 'edited'
  ))) {
    declarations.push(source.slice(edited[0].range.start, edited[0].range.end).trim())
  }

  return insertDeclarationsIntoElementMarkup(
    source,
    structure.defaultChild,
    source.slice(structure.defaultChild.range.start, structure.defaultChild.range.end),
    declarations,
  )
}

function insertDeclarationsIntoElementMarkup(
  source: string,
  node: RComponentSFC_AST_ElementNode,
  markup: string,
  declarations: string[],
): string {
  if (!declarations.length) {
    return markup
  }
  const openingEnd = findOpeningTagEnd(source, node)
  let insertOffset = openingEnd
  while (insertOffset > node.range.start && /\s/.test(source[insertOffset - 1]!)) {
    insertOffset -= 1
  }
  if (source[insertOffset - 1] === '/') {
    insertOffset -= 1
  }
  const openingSource = source.slice(node.range.start, insertOffset)
  const lineStart = source.lastIndexOf('\n', insertOffset - 1) + 1
  const closePrefix = source.slice(lineStart, insertOffset)
  if (openingSource.includes('\n') && !closePrefix.trim()) {
    const indent = inferAttributeIndent(source, node)
    const block = declarations.map(declaration => `${indent}${declaration}\n`).join('')
    return replaceRange(markup, lineStart - node.range.start, lineStart - node.range.start, block)
  }
  while (insertOffset > node.range.start && /[ \t]/.test(source[insertOffset - 1]!)) {
    insertOffset -= 1
  }
  const relativeOffset = insertOffset - node.range.start
  return replaceRange(markup, relativeOffset, relativeOffset, ` ${declarations.join(' ')}`)
}

function normalizeMarkupIndent(markup: string): string {
  const lines = markup.split('\n')
  const indents = lines.slice(1)
    .filter(line => line.trim())
    .map(line => line.match(/^\s*/)?.[0].length ?? 0)
  const remove = indents.length ? Math.min(...indents) : 0
  return lines.map((line, index) => index === 0 ? line : line.slice(Math.min(remove, line.length))).join('\n')
}

function indentMarkup(markup: string, indent: string): string {
  return markup.split('\n').map(line => `${indent}${line}`).join('\n')
}

function renameElementTag(
  source: string,
  node: RComponentSFC_AST_ElementNode,
  nextTag: string,
): string {
  if (node.tag === nextTag) {
    return source
  }

  let nextSource = source
  if (!node.selfClosing) {
    const closingTagStart = findClosingTagStart(source, node)
    nextSource = replaceRange(
      nextSource,
      closingTagStart + 2,
      closingTagStart + 2 + node.tag.length,
      nextTag,
    )
  }

  return replaceRange(
    nextSource,
    node.range.start + 1,
    node.range.start + 1 + node.tag.length,
    nextTag,
  )
}

function componentCellMarkup(identity: string): string {
  return `<Cell>\n  <Component is="${escapeAttribute(identity)}" />\n</Cell>`
}

function componentMarkup(identity: string): string {
  return `<Component is="${escapeAttribute(identity)}" />`
}

function tagCellMarkup(tag: ComponentSFCTableVisualCellTag): string {
  return `<Cell>\n  ${tagMarkup(tag)}\n</Cell>`
}

function tagMarkup(tag: ComponentSFCTableVisualCellTag): string {
  if (tag === 'Text' || tag === 'DateTime' || tag === 'Number' || tag === 'Input' || tag === 'Textarea' || tag === 'Select') {
    return `<${tag} :value="value" />`
  }
  if (tag === 'Icon') {
    return '<Icon :name="value" />'
  }
  if (tag === 'Checkbox') {
    return '<Checkbox :checked="Boolean(value)" />'
  }
  if (tag === 'Dot') {
    return '<Dot :tone="value" />'
  }
  if (tag === 'Divider') {
    return '<Divider />'
  }
  return `<${tag}>{{ value }}</${tag}>`
}

function isVisualCellTag(tag: string): tag is ComponentSFCTableVisualCellTag {
  return isComponentSFCBuiltInTag(tag) && !NON_VISUAL_CELL_TAGS.has(tag)
}

function setNodeAttribute(
  source: string,
  node: RComponentSFC_AST_ElementNode,
  name: string,
  value: string | null,
): string {
  const attribute = node.attributes.find(item => item.name === name)
  const directive = node.directives.find((item) => {
    if (item.name === name) {
      return true
    }
    return item.name === 'bind' && item.argument === name
  })
  const declaration = attribute ?? directive ?? null

  if (declaration) {
    const raw = source.slice(declaration.range.start, declaration.range.end).trim()
    const dynamic = attribute?.dynamic
      || raw.startsWith(':')
      || raw.startsWith('v-bind:')
    if (dynamic) {
      throw new Error(`Dynamic attribute ${name} редактируется только во вкладке Source.`)
    }
    if (value == null) {
      return removeRangeWithWhitespace(source, declaration.range.start, declaration.range.end)
    }
    return replaceRange(
      source,
      declaration.range.start,
      declaration.range.end,
      serializeAttribute(name, value),
    )
  }

  if (value == null) {
    return source
  }
  return insertAttribute(source, node, serializeAttribute(name, value))
}

function setNodeAttributeValue(
  source: string,
  node: RComponentSFC_AST_ElementNode,
  name: string,
  value: string | null,
  valueKind: 'expression' | 'literal',
): string {
  const declarations = node.attributes.filter(item => item.name === name)
  if (declarations.length > 1) {
    throw new Error(`Параметр ${name} объявлен несколько раз. Измените его во вкладке Source.`)
  }

  const declaration = declarations[0] ?? null
  if (declaration) {
    if (value == null) {
      return removeRangeWithWhitespace(source, declaration.range.start, declaration.range.end)
    }
    return replaceRange(
      source,
      declaration.range.start,
      declaration.range.end,
      serializeAttributeValue(name, value, valueKind),
    )
  }

  if (value == null) {
    return source
  }
  return insertAttribute(source, node, serializeAttributeValue(name, value, valueKind))
}

function setNodeDirectiveExpression(
  source: string,
  node: RComponentSFC_AST_ElementNode,
  name: string,
  value: string | null,
): string {
  const declarations = node.directives.filter(item => item.name === name)
  if (declarations.length > 1) {
    throw new Error(`Директива v-${name} объявлена несколько раз. Измените её во вкладке Source.`)
  }
  const declaration = declarations[0] ?? null
  if (declaration) {
    if (value == null) {
      return removeRangeWithWhitespace(source, declaration.range.start, declaration.range.end)
    }
    return replaceRange(source, declaration.range.start, declaration.range.end, `v-${name}="${escapeAttribute(value)}"`)
  }
  if (value == null) {
    return source
  }
  return insertAttribute(source, node, `v-${name}="${escapeAttribute(value)}"`)
}

function serializeAttribute(name: string, value: string): string {
  return `${name}="${escapeAttribute(value)}"`
}

function serializeAttributeValue(
  name: string,
  value: string,
  valueKind: 'expression' | 'literal',
): string {
  const prefix = valueKind === 'expression' ? ':' : ''
  return `${prefix}${name}="${escapeAttribute(value)}"`
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function insertAttribute(source: string, node: RComponentSFC_AST_ElementNode, attribute: string): string {
  const closeOffset = findOpeningTagEnd(source, node)
  let insertOffset = closeOffset
  while (insertOffset > node.range.start && /\s/.test(source[insertOffset - 1])) {
    insertOffset -= 1
  }
  if (source[insertOffset - 1] === '/') {
    insertOffset -= 1
  }

  const openingSource = source.slice(node.range.start, insertOffset)
  const lineStart = source.lastIndexOf('\n', insertOffset - 1) + 1
  const closePrefix = source.slice(lineStart, insertOffset)
  if (openingSource.includes('\n') && !closePrefix.trim()) {
    const indent = inferAttributeIndent(source, node)
    return replaceRange(source, lineStart, lineStart, `${indent}${attribute}\n`)
  }

  while (insertOffset > node.range.start && /[ \t]/.test(source[insertOffset - 1])) {
    insertOffset -= 1
  }

  return replaceRange(source, insertOffset, insertOffset, ` ${attribute}`)
}

function inferAttributeIndent(source: string, node: RComponentSFC_AST_ElementNode): string {
  const first = [...node.attributes, ...node.directives]
    .sort((left, right) => left.range.start - right.range.start)[0]
  if (first) {
    const lineStart = source.lastIndexOf('\n', first.range.start - 1) + 1
    const prefix = source.slice(lineStart, first.range.start)
    if (!prefix.trim()) {
      return prefix
    }
  }
  return `${lineIndent(source, node.range.start)}  `
}

function insertChild(source: string, node: RComponentSFC_AST_ElementNode, markup: string): string {
  const ownIndent = lineIndent(source, node.range.start)
  const childIndent = inferChildIndent(source, node, ownIndent)
  const indentedMarkup = markup
    .split('\n')
    .map(line => `${childIndent}${line}`)
    .join('\n')

  if (node.selfClosing) {
    const closeOffset = findOpeningTagEnd(source, node)
    let slashOffset = closeOffset - 1
    while (slashOffset > node.range.start && /\s/.test(source[slashOffset])) {
      slashOffset -= 1
    }
    if (source[slashOffset] !== '/') {
      throw new Error(`Не удалось раскрыть self-closing тег ${node.tag}.`)
    }
    return replaceRange(
      source,
      slashOffset,
      closeOffset + 1,
      `>\n${indentedMarkup}\n${ownIndent}</${node.tag}>`,
    )
  }

  const closeTagOffset = findClosingTagStart(source, node)
  const closeLineStart = source.lastIndexOf('\n', closeTagOffset - 1) + 1
  const closePrefix = source.slice(closeLineStart, closeTagOffset)
  if (!closePrefix.trim()) {
    return replaceRange(source, closeLineStart, closeLineStart, `${indentedMarkup}\n`)
  }

  return replaceRange(
    source,
    closeTagOffset,
    closeTagOffset,
    `\n${indentedMarkup}\n${ownIndent}`,
  )
}

function inferChildIndent(source: string, node: RComponentSFC_AST_ElementNode, ownIndent: string): string {
  const firstChild = node.children.find(isSemanticNode)
  if (!firstChild) {
    return `${ownIndent}  `
  }
  const indent = lineIndent(source, firstChild.range.start)
  return indent.length > ownIndent.length ? indent : `${ownIndent}  `
}

function removeNode(source: string, node: RComponentSFC_AST_ElementNode): string {
  const lineStart = source.lastIndexOf('\n', node.range.start - 1) + 1
  const nextLineBreak = source.indexOf('\n', node.range.end)
  const lineEnd = nextLineBreak >= 0 ? nextLineBreak : source.length
  const prefix = source.slice(lineStart, node.range.start)
  const suffix = source.slice(node.range.end, lineEnd)
  if (!prefix.trim() && !suffix.trim()) {
    const removeEnd = nextLineBreak >= 0 ? nextLineBreak + 1 : lineEnd
    return replaceRange(source, lineStart, removeEnd, '')
  }
  return replaceRange(source, node.range.start, node.range.end, '')
}

function removeRangeWithWhitespace(source: string, rangeStart: number, rangeEnd: number): string {
  const lineStart = source.lastIndexOf('\n', rangeStart - 1) + 1
  const lineEnd = source.indexOf('\n', rangeEnd)
  const end = lineEnd >= 0 ? lineEnd : source.length
  if (!source.slice(lineStart, rangeStart).trim() && !source.slice(rangeEnd, end).trim()) {
    return replaceRange(source, lineStart, lineEnd >= 0 ? lineEnd + 1 : end, '')
  }

  let start = rangeStart
  while (start > lineStart && /[ \t]/.test(source[start - 1])) {
    start -= 1
  }
  return replaceRange(source, start, rangeEnd, '')
}

function findOpeningTagEnd(source: string, node: RComponentSFC_AST_ElementNode): number {
  let quote: '"' | '\'' | null = null
  for (let index = node.range.start; index < node.range.end; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === quote) {
        quote = null
      }
      continue
    }
    if (character === '"' || character === '\'') {
      quote = character
      continue
    }
    if (character === '>') {
      return index
    }
  }
  throw new Error(`Не найден конец открывающего тега ${node.tag}.`)
}

function findClosingTagStart(source: string, node: RComponentSFC_AST_ElementNode): number {
  const local = source.slice(node.range.start, node.range.end)
  const relativeOffset = local.lastIndexOf(`</${node.tag}`)
  if (relativeOffset < 0) {
    throw new Error(`Не найден закрывающий тег ${node.tag}.`)
  }
  return node.range.start + relativeOffset
}

function lineIndent(source: string, offset: number): string {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1
  const prefix = source.slice(lineStart, offset)
  const match = prefix.match(/^\s*/)
  return match?.[0] ?? ''
}

function replaceRange(source: string, start: number, end: number, value: string): string {
  return `${source.slice(0, start)}${value}${source.slice(end)}`
}
