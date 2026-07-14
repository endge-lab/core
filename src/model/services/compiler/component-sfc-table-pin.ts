import type { RComponentDiagnostic } from '@/domain/types/component/component-core.types'
import type {
  RComponentSFC_IR_ElementNode,
  RComponentSFC_IR_Value,
} from '@/domain/types/component/sfc'
import type { TableColumnPinSide } from '@/domain/types/runtime/command.types'

export const SFC_TABLE_COLUMN_PIN_MODES = ['enabled', 'disabled'] as const
export const SFC_TABLE_COLUMN_PIN_SIDES = ['left', 'right'] as const

export type ComponentSFCTableColumnPinMode = typeof SFC_TABLE_COLUMN_PIN_MODES[number]
export type ComponentSFCTableColumnPinSide = typeof SFC_TABLE_COLUMN_PIN_SIDES[number]

export interface ComponentSFCTableColumnPinStateItem {
  key: string
  side: ComponentSFCTableColumnPinSide
}

export interface ComponentSFCTableColumnPinDescriptor {
  mode: ComponentSFCTableColumnPinMode
  defaultPin: ComponentSFCTableColumnPinStateItem[]
  columns: ComponentSFCTableColumnPinCapability[]
  diagnostics: RComponentDiagnostic[]
}

export interface ComponentSFCTableColumnPinCapability {
  key: string
  pinnable: boolean
}

const PIN_MODE_SET = new Set<string>(SFC_TABLE_COLUMN_PIN_MODES)
const PIN_SIDE_SET = new Set<string>(SFC_TABLE_COLUMN_PIN_SIDES)

/** Нормализует declarative pin props SFC Table без renderer-specific деталей. */
export function normalizeComponentSFCTableColumnPin(
  tableNode: RComponentSFC_IR_ElementNode,
): ComponentSFCTableColumnPinDescriptor {
  const diagnostics: RComponentDiagnostic[] = []
  const mode = normalizePinMode(
    readLiteralProp(tableNode, 'column-pin') ?? readLiteralProp(tableNode, 'columnPin'),
    diagnostics,
  )
  const columns = collectColumnPinCapabilities(tableNode)
  const defaultPin = parseDefaultPin(
    readLiteralProp(tableNode, 'default-pin') ?? readLiteralProp(tableNode, 'defaultPin'),
    columns,
    diagnostics,
  )

  if (mode === 'disabled' && defaultPin.length > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'sfc-table-default-pin-disabled',
      message: 'default-pin задан, но column-pin="disabled" отключает runtime-закрепление колонок.',
      sourcePath: 'template.Table.default-pin',
    })
  }

  return {
    mode,
    defaultPin: mode === 'disabled' ? [] : defaultPin,
    columns,
    diagnostics,
  }
}

export function normalizeComponentSFCTableColumnPinMode(value: unknown): ComponentSFCTableColumnPinMode {
  const source = String(value ?? '').trim()
  return PIN_MODE_SET.has(source) ? source as ComponentSFCTableColumnPinMode : 'enabled'
}

export function normalizeTableColumnPinSide(value: unknown): TableColumnPinSide {
  const source = String(value ?? '').trim()
  return source === 'left' || source === 'right' ? source : 'none'
}

function collectColumnPinCapabilities(
  tableNode: RComponentSFC_IR_ElementNode,
): ComponentSFCTableColumnPinCapability[] {
  const columns: ComponentSFCTableColumnPinCapability[] = []
  let visibleIndex = 0

  for (const child of tableNode.children) {
    if (child.kind !== 'element' || child.tag !== 'Column')
      continue

    columns.push({
      key: normalizeColumnKey(child, visibleIndex),
      pinnable: readBooleanProp(child, 'pinnable', true),
    })
    visibleIndex++
  }

  return columns
}

function normalizePinMode(
  value: unknown,
  diagnostics: RComponentDiagnostic[],
): ComponentSFCTableColumnPinMode {
  if (value == null || value === '')
    return 'enabled'

  const mode = String(value).trim()
  if (PIN_MODE_SET.has(mode))
    return mode as ComponentSFCTableColumnPinMode

  diagnostics.push({
    severity: 'error',
    code: 'sfc-table-column-pin-mode-invalid',
    message: `Table column-pin "${mode}" не поддерживается. Используйте enabled или disabled.`,
    sourcePath: 'template.Table.column-pin',
  })
  return 'enabled'
}

function parseDefaultPin(
  value: unknown,
  columns: ComponentSFCTableColumnPinCapability[],
  diagnostics: RComponentDiagnostic[],
): ComponentSFCTableColumnPinStateItem[] {
  const source = String(value ?? '').trim()
  if (!source)
    return []

  const columnKeys = new Set(columns.map(column => column.key))
  const seenKeys = new Set<string>()
  const result: ComponentSFCTableColumnPinStateItem[] = []

  for (const rawItem of source.split(',')) {
    const item = rawItem.trim()
    if (!item)
      continue

    const [rawKey, rawSide] = item.split(':').map(part => part?.trim())
    const key = rawKey ?? ''
    const side = rawSide ?? ''

    if (!key) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-table-default-pin-invalid',
        message: `default-pin содержит пустой ключ в "${item}".`,
        sourcePath: 'template.Table.default-pin',
      })
      continue
    }

    if (!PIN_SIDE_SET.has(side)) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-table-default-pin-invalid',
        message: `default-pin для "${key}" использует неизвестную сторону "${side}". Используйте left или right.`,
        sourcePath: 'template.Table.default-pin',
      })
      continue
    }

    if (!columnKeys.has(key)) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-table-default-pin-column-missing',
        message: `default-pin ссылается на колонку "${key}", но такой Column нет.`,
        sourcePath: 'template.Table.default-pin',
      })
      continue
    }

    if (seenKeys.has(key)) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-table-default-pin-duplicate',
        message: `default-pin содержит повторную настройку для колонки "${key}".`,
        sourcePath: 'template.Table.default-pin',
      })
      continue
    }

    seenKeys.add(key)
    result.push({
      key,
      side: side as ComponentSFCTableColumnPinSide,
    })
  }

  return result
}

function normalizeColumnKey(node: RComponentSFC_IR_ElementNode, visibleIndex: number): string {
  const key = readStaticStringValue(node.props.key) ?? readStaticStringValue(node.directives.key)
  return key || `column_${visibleIndex}`
}

function readBooleanProp(node: RComponentSFC_IR_ElementNode, name: string, fallback: boolean): boolean {
  const value = readLiteralProp(node, name)
  if (value == null || value === '')
    return fallback
  if (value === true)
    return true
  if (value === false)
    return false
  if (typeof value === 'string')
    return value !== 'false'
  return fallback
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
