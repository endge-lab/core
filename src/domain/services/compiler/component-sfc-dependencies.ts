import type {
  RComponentSFC_IR,
  RComponentSFC_IR_Directives,
  RComponentSFC_IR_ElementNode,
  RComponentSFC_IR_Node,
  RComponentSFC_IR_Read,
  RComponentSFC_IR_Value,
  RComponentSFC_RuntimeBoundaryDependency,
  RComponentSFC_RuntimeDependencies,
  RComponentSFC_RuntimeDependency,
  RComponentSFC_RuntimeTableColumnDependency,
} from '@/domain/types/component-sfc.types'
import { createEmptyComponentSFCRuntimeDependencies } from '@/domain/types/component-sfc.types'

/** Анализирует SFC IR и собирает runtime-зависимости от входных props. */
export function analyzeComponentSFCRuntimeDependencies(
  ir: RComponentSFC_IR | null,
): RComponentSFC_RuntimeDependencies {
  const result = createEmptyComponentSFCRuntimeDependencies()
  if (!ir)
    return result

  const props = new Set(ir.script.props.map(prop => prop.name))
  const seen = new Set<string>()

  for (const node of ir.template.roots) {
    collectNodeDependencies(node, props, result, seen)
    collectBoundaryDependencies(node, props, result)
  }

  result.props = prunePrefixDependencies(result.props)

  return result
}

function collectNodeDependencies(
  node: RComponentSFC_IR_Node,
  props: Set<string>,
  result: RComponentSFC_RuntimeDependencies,
  seen: Set<string>,
): void {
  if (node.kind === 'expression') {
    collectValueDependencies(node.value, props, result, seen)
    return
  }

  if (node.kind !== 'element')
    return

  for (const value of Object.values(node.props))
    collectValueDependencies(value, props, result, seen)

  collectDirectiveDependencies(node.directives, props, result, seen)

  for (const child of node.children)
    collectNodeDependencies(child, props, result, seen)
}

function collectDirectiveDependencies(
  directives: RComponentSFC_IR_Directives,
  props: Set<string>,
  result: RComponentSFC_RuntimeDependencies,
  seen: Set<string>,
): void {
  collectValueDependencies(directives.if, props, result, seen)
  collectValueDependencies(directives.elseIf, props, result, seen)
  collectValueDependencies(directives.key, props, result, seen)
  collectValueDependencies(directives.for?.source, props, result, seen)
}

function collectValueDependencies(
  value: RComponentSFC_IR_Value | undefined,
  props: Set<string>,
  result: RComponentSFC_RuntimeDependencies,
  seen: Set<string>,
): void {
  if (!value || value.kind !== 'expression')
    return

  for (const read of value.reads) {
    const dependency = normalizePropDependency(read, props)
    if (!dependency)
      continue

    const key = `${dependency.prop}.${dependency.path.join('.')}`
    if (seen.has(key))
      continue

    seen.add(key)
    result.props.push(dependency)
  }
}

function normalizePropDependency(
  read: RComponentSFC_IR_Read,
  props: Set<string>,
): RComponentSFC_RuntimeDependency | null {
  if (read.source !== 'props')
    return null

  const path = [...read.path]
  if (path[0] === 'props')
    path.shift()

  const prop = path.shift()
  if (!prop || !props.has(prop))
    return null

  return {
    source: 'props',
    prop,
    path,
    raw: read.raw,
    read,
  }
}

function prunePrefixDependencies(
  dependencies: RComponentSFC_RuntimeDependency[],
): RComponentSFC_RuntimeDependency[] {
  return dependencies.filter((candidate) => {
    return !dependencies.some(other => {
      if (candidate === other || candidate.prop !== other.prop)
        return false

      return candidate.path.length < other.path.length
        && candidate.path.every((part, index) => part === other.path[index])
    })
  })
}

function collectBoundaryDependencies(
  node: RComponentSFC_IR_Node,
  props: Set<string>,
  result: RComponentSFC_RuntimeDependencies,
): void {
  if (node.kind !== 'element')
    return

  if (node.tag === 'Table') {
    const boundary = createTableBoundaryDependency(node, props)
    if (boundary)
      result.boundaries.push(boundary)
  }

  for (const child of node.children)
    collectBoundaryDependencies(child, props, result)
}

function createTableBoundaryDependency(
  node: RComponentSFC_IR_ElementNode,
  props: Set<string>,
): RComponentSFC_RuntimeBoundaryDependency | null {
  const rows = normalizePropBinding(node.props.rows, props)
  if (!rows)
    return null

  return {
    id: node.id,
    kind: 'table',
    sourceProp: rows.prop,
    sourcePath: rows.path,
    rowKey: normalizeLiteralString(node.props['row-key'] ?? node.props.rowKey),
    columns: collectTableColumnDependencies(node),
  }
}

function collectTableColumnDependencies(
  tableNode: RComponentSFC_IR_ElementNode,
): RComponentSFC_RuntimeTableColumnDependency[] {
  let visibleIndex = 0
  const columns: RComponentSFC_RuntimeTableColumnDependency[] = []

  for (const child of tableNode.children) {
    if (child.kind !== 'element' || child.tag !== 'Column')
      continue

    const key = normalizeLiteralString(child.props.key ?? child.directives.key) ?? `column_${visibleIndex}`
    columns.push({
      id: child.id,
      key,
      index: visibleIndex,
      rowReads: collectRowReads(resolveCellNodes(child), key),
    })
    visibleIndex++
  }

  return columns
}

function resolveCellNodes(columnNode: RComponentSFC_IR_ElementNode): RComponentSFC_IR_Node[] {
  const cell = columnNode.children
    .filter((node): node is RComponentSFC_IR_ElementNode => node.kind === 'element')
    .find(node => node.tag === 'Cell')

  return cell?.children ?? columnNode.children
}

function collectRowReads(nodes: RComponentSFC_IR_Node[], columnKey: string): string[] {
  const result = new Set<string>()

  for (const node of nodes)
    collectRowReadsFromNode(node, result, columnKey)

  return [...result]
}

function collectRowReadsFromNode(
  node: RComponentSFC_IR_Node,
  result: Set<string>,
  columnKey: string,
): void {
  if (node.kind === 'expression') {
    if (node.value.kind === 'expression')
      collectRowReadsFromSource(node.value.source, result, columnKey)
    return
  }

  if (node.kind !== 'element')
    return

  for (const value of Object.values(node.props)) {
    if (value.kind === 'expression')
      collectRowReadsFromSource(value.source, result, columnKey)
  }

  for (const value of [
    node.directives.if,
    node.directives.elseIf,
    node.directives.key,
    node.directives.for?.source,
  ]) {
    if (value?.kind === 'expression')
      collectRowReadsFromSource(value.source, result, columnKey)
  }

  for (const child of node.children)
    collectRowReadsFromNode(child, result, columnKey)
}

function collectRowReadsFromSource(source: string, result: Set<string>, columnKey: string): void {
  const rowFieldPattern = /\brow\.([A-Za-z_$][\w$]*)/g
  let match: RegExpExecArray | null

  while ((match = rowFieldPattern.exec(source)))
    result.add(match[1])

  if (/\bvalue\b/.test(source))
    result.add(columnKey)
}

function normalizePropBinding(
  value: RComponentSFC_IR_Value | undefined,
  props: Set<string>,
): { prop: string, path: string[] } | null {
  if (!value || value.kind !== 'expression')
    return null

  for (const read of value.reads) {
    const dependency = normalizePropDependency(read, props)
    if (dependency)
      return {
        prop: dependency.prop,
        path: dependency.path,
      }
  }

  return null
}

function normalizeLiteralString(value: RComponentSFC_IR_Value | undefined): string | null {
  if (!value)
    return null

  const source = value.kind === 'literal'
    ? String(value.value ?? '').trim()
    : value.reads.length === 0
      ? value.source.trim().replace(/^['"]|['"]$/g, '')
      : ''

  return source || null
}
