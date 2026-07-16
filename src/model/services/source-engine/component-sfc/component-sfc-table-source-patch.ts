import type {
  ComponentSFCTableSourcePatch,
  ComponentSFCTableSourcePatchResult,
  RComponentSFC_AST_ElementNode,
  RComponentSFC_AST_TemplateNode,
} from '@/domain/types/component/sfc'
import type { RComponentDiagnostic } from '@/domain/types/component/component-core.types'

import { compileComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-compile'
import { inspectComponentSFCVisual } from '@/model/services/source-engine/component-sfc/component-sfc-visual-projection'

interface TableSourceContext {
  table: RComponentSFC_AST_ElementNode
  columns: RComponentSFC_AST_ElementNode[]
  diagnostics: RComponentDiagnostic[]
}

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
    case 'set-column-component':
      return setColumnComponent(
        source,
        requireColumn(context, patch.columnIndex),
        patch.identity,
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
): string {
  const identity = rawIdentity?.trim() || null
  const cell = column.children.find(
    (node): node is RComponentSFC_AST_ElementNode => node.kind === 'element' && node.tag === 'Cell',
  ) ?? null

  if (!cell) {
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
  const isEmptyManagedCell = semanticChildren.length === 0

  if (!component && !isEmptyManagedCell)
    throw new Error('Ячейка содержит произвольный Source. Измените её во вкладке Source.')

  if (!identity)
    return removeNode(source, cell)
  if (!component)
    return insertChild(source, cell, `<Component is="${escapeAttribute(identity)}" />`)

  return setNodeAttribute(source, component, 'is', identity)
}

function componentCellMarkup(identity: string): string {
  return `<Cell>\n  <Component is="${escapeAttribute(identity)}" />\n</Cell>`
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

function serializeAttribute(name: string, value: string): string {
  return `${name}="${escapeAttribute(value)}"`
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
