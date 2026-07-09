import type { RComponentDiagnostic } from '@/domain/types/component-core.types'
import type {
  RComponentSFC_IR_ElementNode,
  RComponentSFC_IR_Value,
} from '@/domain/types/component-sfc.types'

export const SFC_TABLE_SORT_MODES = ['multiple', 'single', 'fixed', 'disabled'] as const
export const SFC_TABLE_SORT_COMPARATORS = ['natural', 'text', 'number', 'date', 'time', 'boolean'] as const
export const SFC_TABLE_SORT_DIRECTIONS = ['asc', 'desc'] as const

export type ComponentSFCTableSortMode = typeof SFC_TABLE_SORT_MODES[number]
export type ComponentSFCTableSortComparator = typeof SFC_TABLE_SORT_COMPARATORS[number]
export type ComponentSFCTableSortDirection = typeof SFC_TABLE_SORT_DIRECTIONS[number]

export interface ComponentSFCTableSortStateItem {
  key: string
  direction: ComponentSFCTableSortDirection
}

export interface ComponentSFCTableColumnSortDescriptor {
  key: string
  sortable: boolean
  comparator: ComponentSFCTableSortComparator
  paths: string[]
}

export interface ComponentSFCTableSortDescriptor {
  mode: ComponentSFCTableSortMode
  defaultSort: ComponentSFCTableSortStateItem[]
  columns: ComponentSFCTableColumnSortDescriptor[]
  diagnostics: RComponentDiagnostic[]
}

const SORT_MODE_SET = new Set<string>(SFC_TABLE_SORT_MODES)
const SORT_COMPARATOR_SET = new Set<string>(SFC_TABLE_SORT_COMPARATORS)
const SORT_DIRECTION_SET = new Set<string>(SFC_TABLE_SORT_DIRECTIONS)

/** Нормализует декларативные sort props SFC Table из IR без выполнения пользовательского кода. */
export function normalizeComponentSFCTableSort(
  tableNode: RComponentSFC_IR_ElementNode,
): ComponentSFCTableSortDescriptor {
  const diagnostics: RComponentDiagnostic[] = []
  const mode = normalizeSortMode(readLiteralProp(tableNode, 'sort-mode') ?? readLiteralProp(tableNode, 'sortMode'), diagnostics)
  const columns = collectSortableColumns(tableNode, diagnostics)
  const defaultSort = parseDefaultSort(readLiteralProp(tableNode, 'default-sort') ?? readLiteralProp(tableNode, 'defaultSort'), columns, diagnostics)

  if (mode === 'disabled' && defaultSort.length > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'sfc-table-default-sort-disabled',
      message: 'default-sort задан, но sort-mode="disabled" полностью отключает сортировку.',
      sourcePath: 'template.Table.default-sort',
    })
  }

  return {
    mode,
    defaultSort: mode === 'disabled' ? [] : defaultSort,
    columns,
    diagnostics,
  }
}

export function normalizeComponentSFCTableSortComparator(value: unknown): ComponentSFCTableSortComparator | null {
  const source = String(value ?? '').trim()
  return SORT_COMPARATOR_SET.has(source) ? source as ComponentSFCTableSortComparator : null
}

export function normalizeComponentSFCTableSortMode(value: unknown): ComponentSFCTableSortMode {
  const source = String(value ?? '').trim()
  return SORT_MODE_SET.has(source) ? source as ComponentSFCTableSortMode : 'multiple'
}

export function parseComponentSFCTableSortPaths(value: unknown, fallback: string): string[] {
  const paths = String(value ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)

  return paths.length > 0 ? paths : [fallback]
}

function collectSortableColumns(
  tableNode: RComponentSFC_IR_ElementNode,
  diagnostics: RComponentDiagnostic[],
): ComponentSFCTableColumnSortDescriptor[] {
  const columns: ComponentSFCTableColumnSortDescriptor[] = []
  let visibleIndex = 0

  for (const child of tableNode.children) {
    if (child.kind !== 'element' || child.tag !== 'Column')
      continue

    const key = normalizeColumnKey(child, visibleIndex)
    const sortable = readBooleanProp(child, 'sortable')
    const rawComparator = readLiteralProp(child, 'sort')
    const comparator = rawComparator == null || rawComparator === ''
      ? 'natural'
      : normalizeComponentSFCTableSortComparator(rawComparator)

    if (!comparator) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-table-sort-comparator-invalid',
        message: `Column "${key}" использует неизвестный comparator "${String(rawComparator)}".`,
        sourcePath: `template.Table.Column.${key}.sort`,
        start: child.sourceRange.start,
        end: child.sourceRange.end,
      })
    }

    if (sortable || rawComparator != null || readLiteralProp(child, 'sort-by') != null || readLiteralProp(child, 'sortBy') != null) {
      columns.push({
        key,
        sortable,
        comparator: comparator ?? 'natural',
        paths: parseComponentSFCTableSortPaths(readLiteralProp(child, 'sort-by') ?? readLiteralProp(child, 'sortBy'), key),
      })
    }

    visibleIndex++
  }

  return columns
}

function normalizeSortMode(
  value: unknown,
  diagnostics: RComponentDiagnostic[],
): ComponentSFCTableSortMode {
  if (value == null || value === '')
    return 'multiple'

  const mode = String(value).trim()
  if (SORT_MODE_SET.has(mode))
    return mode as ComponentSFCTableSortMode

  diagnostics.push({
    severity: 'error',
    code: 'sfc-table-sort-mode-invalid',
    message: `Table sort-mode "${mode}" не поддерживается. Используйте multiple, single, fixed или disabled.`,
    sourcePath: 'template.Table.sort-mode',
  })
  return 'multiple'
}

function parseDefaultSort(
  value: unknown,
  columns: ComponentSFCTableColumnSortDescriptor[],
  diagnostics: RComponentDiagnostic[],
): ComponentSFCTableSortStateItem[] {
  const source = String(value ?? '').trim()
  if (!source)
    return []

  const columnKeys = new Set(columns.map(column => column.key))
  const result: ComponentSFCTableSortStateItem[] = []

  for (const rawItem of source.split(',')) {
    const item = rawItem.trim()
    if (!item)
      continue

    const [rawKey, rawDirection] = item.split(':').map(part => part?.trim())
    const key = rawKey ?? ''
    const direction = rawDirection ?? 'asc'

    if (!key) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-table-default-sort-invalid',
        message: `default-sort содержит пустой ключ в "${item}".`,
        sourcePath: 'template.Table.default-sort',
      })
      continue
    }

    if (!SORT_DIRECTION_SET.has(direction)) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-table-default-sort-invalid',
        message: `default-sort для "${key}" использует неизвестное направление "${direction}". Используйте asc или desc.`,
        sourcePath: 'template.Table.default-sort',
      })
      continue
    }

    if (!columnKeys.has(key)) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-table-default-sort-column-missing',
        message: `default-sort ссылается на колонку "${key}", но такой sortable/sort Column нет.`,
        sourcePath: 'template.Table.default-sort',
      })
      continue
    }

    result.push({
      key,
      direction: direction as ComponentSFCTableSortDirection,
    })
  }

  return result
}

function normalizeColumnKey(node: RComponentSFC_IR_ElementNode, visibleIndex: number): string {
  const key = readStaticStringValue(node.props.key) ?? readStaticStringValue(node.directives.key)
  return key || `column_${visibleIndex}`
}

function readBooleanProp(node: RComponentSFC_IR_ElementNode, name: string): boolean {
  const value = readLiteralProp(node, name)
  if (value === true)
    return true
  if (value === false)
    return false
  if (typeof value === 'string')
    return value !== 'false'
  return false
}

function readLiteralProp(node: RComponentSFC_IR_ElementNode, name: string): unknown {
  return readLiteralValue(node.props[name])
}

function readLiteralValue(value: RComponentSFC_IR_Value | undefined): unknown {
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
