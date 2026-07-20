import type {
  ComponentSFCTableSourcePatch,
  ComponentSFCTableSourcePatchResult,
  ComponentSFCTableVisualCellTag,
  RComponentSFC_AST_ElementNode,
  RComponentSFC_AST_TemplateNode,
} from '@/domain/types/component/sfc'
import type { RComponentDiagnostic } from '@/domain/types/component/component-core.types'

import { compileComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-compile'
import { compileComponentSFCExpression } from '@/model/services/compiler/component-sfc/component-sfc-expression'
import { isComponentSFCBuiltInTag } from '@/model/services/compiler/component-sfc/component-sfc-template'
import { inspectComponentSFCVisual } from '@/model/services/source-engine/component-sfc/component-sfc-visual-projection'

interface TableSourceContext {
  table: RComponentSFC_AST_ElementNode
  columns: RComponentSFC_AST_ElementNode[]
  diagnostics: RComponentDiagnostic[]
}

const NON_VISUAL_CELL_TAGS = new Set([
  'Component',
  'Table',
  'Column',
  'Cell',
  'ColumnMenu',
  'MenuItem',
  'MenuSeparator',
])

/** Применяет одну узкую visual-editor операцию, не перепечатывая остальной SFC source. */
export function patchComponentSFCTableSource(
  source: string,
  patch: ComponentSFCTableSourcePatch,
): ComponentSFCTableSourcePatchResult {
  const context = resolveTableContext(source)
  if (!context) {
    const inspection = inspectComponentSFCVisual(source)
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
    const inspection = inspectComponentSFCVisual(nextSource)
    if (inspection.support.kind !== 'table' || !inspection.projection) {
      return {
        ok: false,
        source,
        changed: false,
        projection: null,
        diagnostics: inspection.diagnostics,
        message: 'Изменение нарушило структуру корневого Table.',
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
      projection: inspectComponentSFCVisual(source).projection,
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
  }
}

function resolveTableContext(source: string): TableSourceContext | null {
  const result = compileComponentSFC(source)
  const roots = result.ast?.template?.roots.filter(isSemanticNode) ?? []
  if (roots.length !== 1 || roots[0].kind !== 'element' || roots[0].tag !== 'Table')
    return null

  return {
    table: roots[0],
    columns: roots[0].children.filter(
      (node): node is RComponentSFC_AST_ElementNode => node.kind === 'element' && node.tag === 'Column',
    ),
    diagnostics: result.diagnostics,
  }
}

function isSemanticNode(node: RComponentSFC_AST_TemplateNode): boolean {
  return node.kind !== 'text' || Boolean(node.content.trim())
}

function requireColumn(context: TableSourceContext, index: number): RComponentSFC_AST_ElementNode {
  const column = context.columns[index]
  if (!column)
    throw new Error(`Column с индексом ${index} не найден.`)
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
  while (used.has(`column_${index}`))
    index += 1
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
  if (fromIndex === toIndex)
    return source

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
  syntax: 'cell' | 'direct' | undefined,
): string {
  const identity = rawIdentity?.trim() || null
  const cell = column.children.find(
    (node): node is RComponentSFC_AST_ElementNode => node.kind === 'element' && node.tag === 'Cell',
  ) ?? null

  if (!cell) {
    const directChildren = column.children.filter(isSemanticNode)
    if (directChildren.length > 0 && syntax !== 'direct')
      throw new Error('Колонка содержит прямой компонент или произвольный Source. Измените её во вкладке Source.')
    if (directChildren.length > 0)
      return setDirectColumnComponent(source, column, directChildren, identity)
    if (!identity)
      return source
    return insertChild(source, column, componentCellMarkup(identity))
  }

  if (source.slice(cell.range.start, cell.range.end).includes('<!--'))
    throw new Error('Ячейка содержит комментарии или произвольный Source. Измените её во вкладке Source.')

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

  if (!component && !managedTag && !isEmptyManagedCell)
    throw new Error('Ячейка содержит произвольный Source. Измените её во вкладке Source.')

  if (!identity)
    return removeNode(source, cell)
  if (managedTag)
    return replaceRange(source, managedTag.range.start, managedTag.range.end, `<Component is="${escapeAttribute(identity)}" />`)
  if (!component)
    return insertChild(source, cell, `<Component is="${escapeAttribute(identity)}" />`)

  return setNodeAttribute(source, component, 'is', identity)
}

function setColumnTag(
  source: string,
  column: RComponentSFC_AST_ElementNode,
  tag: ComponentSFCTableVisualCellTag | null,
  syntax: 'cell' | 'direct' | undefined,
): string {
  if (tag && !isVisualCellTag(tag))
    throw new Error(`Tag ${tag} нельзя использовать как простой Table Cell.`)

  const cell = column.children.find(
    (node): node is RComponentSFC_AST_ElementNode => node.kind === 'element' && node.tag === 'Cell',
  ) ?? null

  if (!cell) {
    const directChildren = column.children.filter(isSemanticNode)
    if (directChildren.length === 0)
      return tag ? insertChild(source, column, tagCellMarkup(tag)) : source
    if (syntax !== 'direct' || directChildren.length !== 1 || directChildren[0].kind !== 'element')
      throw new Error('Колонка содержит произвольный Source. Измените её во вкладке Source.')
    if (source.slice(column.range.start, column.range.end).includes('<!--'))
      throw new Error('Колонка содержит комментарии или произвольный Source. Измените её во вкладке Source.')
    if (!tag)
      return removeNode(source, directChildren[0])
    if (isVisualCellTag(directChildren[0].tag)) {
      return directChildren[0].tag === tag
        ? source
        : replaceRange(source, directChildren[0].range.start, directChildren[0].range.end, tagMarkup(tag))
    }
    return replaceRange(source, directChildren[0].range.start, directChildren[0].range.end, tagMarkup(tag))
  }

  if (source.slice(cell.range.start, cell.range.end).includes('<!--'))
    throw new Error('Ячейка содержит комментарии или произвольный Source. Измените её во вкладке Source.')

  const semanticChildren = cell.children.filter(isSemanticNode)
  if (semanticChildren.length === 0) {
    if (!tag)
      return removeNode(source, cell)
    return insertChild(source, cell, tagMarkup(tag))
  }

  const child = semanticChildren.length === 1 && semanticChildren[0].kind === 'element'
    ? semanticChildren[0]
    : null
  if (!child || (child.tag !== 'Component' && !isVisualCellTag(child.tag)))
    throw new Error('Ячейка содержит произвольный Source. Измените её во вкладке Source.')
  if (!tag)
    return removeNode(source, cell)
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
  if (!component || source.slice(column.range.start, column.range.end).includes('<!--'))
    throw new Error('Колонка содержит произвольный Source. Измените её во вкладке Source.')

  if (!identity)
    return removeNode(source, component)
  if (component.tag === 'Component')
    return setNodeAttribute(source, component, 'is', identity)

  const hasReservedIs = component.attributes.some(attribute => attribute.name === 'is')
    || component.directives.some(directive => directive.name === 'bind' && directive.argument === 'is')
  if (hasReservedIs)
    throw new Error('Direct component содержит зарезервированный attribute is. Измените его во вкладке Source.')

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
  if (!/^[A-Za-z_$][\w$.-]*$/.test(name))
    throw new Error(`Некорректное имя входного параметра "${rawName}".`)
  if (name === 'is')
    throw new Error('Параметр is управляется выбором компонента.')

  const child = requireManagedColumnCellElement(source, column)
  if (valueKind === 'expression' && value != null) {
    const result = compileComponentSFCExpression(value, {
      sourcePath: `template.Table.Column.${name}`,
    })
    const error = result.diagnostics.find(item => item.severity === 'error')
    if (error)
      throw new Error(error.message)
  }

  return setNodeAttributeValue(source, child, name, value, valueKind)
}

function requireManagedColumnCellElement(
  source: string,
  column: RComponentSFC_AST_ElementNode,
): RComponentSFC_AST_ElementNode {
  if (source.slice(column.range.start, column.range.end).includes('<!--'))
    throw new Error('Колонка содержит комментарии или произвольный Source.')

  const cell = column.children.find(
    (node): node is RComponentSFC_AST_ElementNode => node.kind === 'element' && node.tag === 'Cell',
  ) ?? null
  const children = (cell?.children ?? column.children).filter(isSemanticNode)
  if (children.length !== 1 || children[0].kind !== 'element')
    throw new Error('Для visual bindings нужен один Component или Tag внутри колонки.')

  return children[0]
}

function renameElementTag(
  source: string,
  node: RComponentSFC_AST_ElementNode,
  nextTag: string,
): string {
  if (node.tag === nextTag)
    return source

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

function tagCellMarkup(tag: ComponentSFCTableVisualCellTag): string {
  return `<Cell>\n  ${tagMarkup(tag)}\n</Cell>`
}

function tagMarkup(tag: ComponentSFCTableVisualCellTag): string {
  if (tag === 'Text' || tag === 'DateTime' || tag === 'Number' || tag === 'Input' || tag === 'Textarea' || tag === 'Select')
    return `<${tag} :value="value" />`
  if (tag === 'Icon')
    return '<Icon :name="value" />'
  if (tag === 'Checkbox')
    return '<Checkbox :checked="Boolean(value)" />'
  if (tag === 'Dot')
    return '<Dot :tone="value" />'
  if (tag === 'Divider')
    return '<Divider />'
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
    if (item.name === name)
      return true
    return item.name === 'bind' && item.argument === name
  })
  const declaration = attribute ?? directive ?? null

  if (declaration) {
    const raw = source.slice(declaration.range.start, declaration.range.end).trim()
    const dynamic = attribute?.dynamic
      || raw.startsWith(':')
      || raw.startsWith('v-bind:')
    if (dynamic)
      throw new Error(`Dynamic attribute ${name} редактируется только во вкладке Source.`)
    if (value == null)
      return removeRangeWithWhitespace(source, declaration.range.start, declaration.range.end)
    return replaceRange(
      source,
      declaration.range.start,
      declaration.range.end,
      serializeAttribute(name, value),
    )
  }

  if (value == null)
    return source
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
  if (declarations.length > 1)
    throw new Error(`Параметр ${name} объявлен несколько раз. Измените его во вкладке Source.`)

  const declaration = declarations[0] ?? null
  if (declaration) {
    if (value == null)
      return removeRangeWithWhitespace(source, declaration.range.start, declaration.range.end)
    return replaceRange(
      source,
      declaration.range.start,
      declaration.range.end,
      serializeAttributeValue(name, value, valueKind),
    )
  }

  if (value == null)
    return source
  return insertAttribute(source, node, serializeAttributeValue(name, value, valueKind))
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
  while (insertOffset > node.range.start && /\s/.test(source[insertOffset - 1]))
    insertOffset -= 1
  if (source[insertOffset - 1] === '/')
    insertOffset -= 1

  const openingSource = source.slice(node.range.start, insertOffset)
  const lineStart = source.lastIndexOf('\n', insertOffset - 1) + 1
  const closePrefix = source.slice(lineStart, insertOffset)
  if (openingSource.includes('\n') && !closePrefix.trim()) {
    const indent = inferAttributeIndent(source, node)
    return replaceRange(source, lineStart, lineStart, `${indent}${attribute}\n`)
  }

  while (insertOffset > node.range.start && /[ \t]/.test(source[insertOffset - 1]))
    insertOffset -= 1

  return replaceRange(source, insertOffset, insertOffset, ` ${attribute}`)
}

function inferAttributeIndent(source: string, node: RComponentSFC_AST_ElementNode): string {
  const first = [...node.attributes, ...node.directives]
    .sort((left, right) => left.range.start - right.range.start)[0]
  if (first) {
    const lineStart = source.lastIndexOf('\n', first.range.start - 1) + 1
    const prefix = source.slice(lineStart, first.range.start)
    if (!prefix.trim())
      return prefix
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
    while (slashOffset > node.range.start && /\s/.test(source[slashOffset]))
      slashOffset -= 1
    if (source[slashOffset] !== '/')
      throw new Error(`Не удалось раскрыть self-closing тег ${node.tag}.`)
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
  if (!closePrefix.trim())
    return replaceRange(source, closeLineStart, closeLineStart, `${indentedMarkup}\n`)

  return replaceRange(
    source,
    closeTagOffset,
    closeTagOffset,
    `\n${indentedMarkup}\n${ownIndent}`,
  )
}

function inferChildIndent(source: string, node: RComponentSFC_AST_ElementNode, ownIndent: string): string {
  const firstChild = node.children.find(isSemanticNode)
  if (!firstChild)
    return `${ownIndent}  `
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
  if (!source.slice(lineStart, rangeStart).trim() && !source.slice(rangeEnd, end).trim())
    return replaceRange(source, lineStart, lineEnd >= 0 ? lineEnd + 1 : end, '')

  let start = rangeStart
  while (start > lineStart && /[ \t]/.test(source[start - 1]))
    start -= 1
  return replaceRange(source, start, rangeEnd, '')
}

function findOpeningTagEnd(source: string, node: RComponentSFC_AST_ElementNode): number {
  let quote: '"' | '\'' | null = null
  for (let index = node.range.start; index < node.range.end; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === quote)
        quote = null
      continue
    }
    if (character === '"' || character === '\'') {
      quote = character
      continue
    }
    if (character === '>')
      return index
  }
  throw new Error(`Не найден конец открывающего тега ${node.tag}.`)
}

function findClosingTagStart(source: string, node: RComponentSFC_AST_ElementNode): number {
  const local = source.slice(node.range.start, node.range.end)
  const relativeOffset = local.lastIndexOf(`</${node.tag}`)
  if (relativeOffset < 0)
    throw new Error(`Не найден закрывающий тег ${node.tag}.`)
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
