import type {
  ComponentSFCTableColumnVisibilityDescriptor,
  RComponentSFC_IR_ElementNode,
  RComponentSFC_IR_Value,
} from '@/domain/types/component/sfc'

/** Нормализует authored default-hidden без renderer-specific visibility state. */
export function normalizeComponentSFCTableColumnVisibility(
  tableNode: RComponentSFC_IR_ElementNode,
): ComponentSFCTableColumnVisibilityDescriptor {
  const diagnostics: ComponentSFCTableColumnVisibilityDescriptor['diagnostics'] = []
  const columnKeys = collectColumnKeys(tableNode)
  const knownKeys = new Set(columnKeys)
  const seenKeys = new Set<string>()
  const defaultHidden: string[] = []
  const source = String(
    readLiteralProp(tableNode, 'default-hidden')
    ?? readLiteralProp(tableNode, 'defaultHidden')
    ?? '',
  ).trim()

  for (const rawKey of source.split(',')) {
    const key = rawKey.trim()
    if (!key)
      continue

    if (!knownKeys.has(key)) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-table-default-hidden-column-missing',
        message: `default-hidden ссылается на колонку "${key}", но такой Column нет.`,
        sourcePath: 'template.Table.default-hidden',
      })
      continue
    }

    if (seenKeys.has(key)) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-table-default-hidden-duplicate',
        message: `default-hidden содержит повторную настройку для колонки "${key}".`,
        sourcePath: 'template.Table.default-hidden',
      })
      continue
    }

    seenKeys.add(key)
    defaultHidden.push(key)
  }

  return { defaultHidden, diagnostics }
}

function collectColumnKeys(tableNode: RComponentSFC_IR_ElementNode): string[] {
  const result: string[] = []
  let columnIndex = 0

  for (const child of tableNode.children) {
    if (child.kind !== 'element' || child.tag !== 'Column')
      continue

    result.push(normalizeColumnKey(child, columnIndex))
    columnIndex++
  }

  return result
}

function normalizeColumnKey(node: RComponentSFC_IR_ElementNode, index: number): string {
  const key = readStaticStringValue(node.props.key) ?? readStaticStringValue(node.directives.key)
  return key || `column_${index}`
}

function readLiteralProp(node: RComponentSFC_IR_ElementNode, name: string): unknown {
  const value = node.props[name]
  return value?.kind === 'literal' ? value.value : undefined
}

function readStaticStringValue(value: RComponentSFC_IR_Value | undefined): string | null {
  if (!value)
    return null

  const source = value.kind === 'literal'
    ? String(value.value ?? '').trim()
    : value.reads.length === 0
      ? value.source.trim().replace(/^['"]|['"]$/g, '')
      : ''

  return source || null
}
