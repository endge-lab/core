export type TableSelectionMode = 'none' | 'single' | 'multiple'
export type TableRowActivationKind = 'pointer' | 'keyboard'

export interface TableEventBase {
  tableId: string
}

export interface TableRowActivatedEvent<TRow extends Record<string, unknown> = Record<string, unknown>> extends TableEventBase {
  rowId: string
  rowIndex: number
  row: TRow
  columnKey: string | null
  activation: TableRowActivationKind
}

export interface TableRowContextMenuRequestedEvent<TRow extends Record<string, unknown> = Record<string, unknown>> extends TableEventBase {
  rowId: string
  rowIndex: number
  row: TRow
  columnKey: string | null
  anchor: { x: number, y: number }
}

export interface TableSelectionChangedEvent<TRow extends Record<string, unknown> = Record<string, unknown>> extends TableEventBase {
  mode: Exclude<TableSelectionMode, 'none'>
  selectedRowIds: string[]
  selectedRows: TRow[]
  addedRowIds: string[]
  removedRowIds: string[]
}

export interface TableSortChangedEvent extends TableEventBase {
  sort: Array<{ columnKey: string, direction: 'asc' | 'desc' }>
}

export interface TableColumnVisibilityChangedEvent extends TableEventBase {
  visibility: Record<string, boolean>
  hiddenColumnKeys: string[]
}

export interface TableColumnPinChangedEvent extends TableEventBase {
  left: string[]
  right: string[]
}

export interface TableColumnOrderChangedEvent extends TableEventBase {
  columnKeys: string[]
}

export interface TableColumnSizeChangedEvent extends TableEventBase {
  sizes: Record<string, number>
  changedColumnKey: string | null
}

export interface TablePageChangedEvent extends TableEventBase {
  pageIndex: number
  pageSize: number
  pageCount: number
}

export interface TableEventMap {
  rowActivated: TableRowActivatedEvent
  rowContextMenuRequested: TableRowContextMenuRequestedEvent
  selectionChanged: TableSelectionChangedEvent
  sortChanged: TableSortChangedEvent
  columnVisibilityChanged: TableColumnVisibilityChangedEvent
  columnPinChanged: TableColumnPinChangedEvent
  columnOrderChanged: TableColumnOrderChangedEvent
  columnSizeChanged: TableColumnSizeChangedEvent
  pageChanged: TablePageChangedEvent
}

export type TableEventName = keyof TableEventMap

export interface TableEventDefinition {
  name: TableEventName
  payloadType: string
  description: string
}

/** Canonical renderer-neutral Event manifest of the built-in Table tag. */
export const TABLE_EVENT_DEFINITIONS: readonly TableEventDefinition[] = [
  { name: 'rowActivated', payloadType: 'TableRowActivatedEvent', description: 'Строка активирована указателем или клавиатурой.' },
  { name: 'rowContextMenuRequested', payloadType: 'TableRowContextMenuRequestedEvent', description: 'Для строки запрошено контекстное меню.' },
  { name: 'selectionChanged', payloadType: 'TableSelectionChangedEvent', description: 'Изменился выбор строк.' },
  { name: 'sortChanged', payloadType: 'TableSortChangedEvent', description: 'Изменилась сортировка.' },
  { name: 'columnVisibilityChanged', payloadType: 'TableColumnVisibilityChangedEvent', description: 'Изменилась видимость колонок.' },
  { name: 'columnPinChanged', payloadType: 'TableColumnPinChangedEvent', description: 'Изменилось закрепление колонок.' },
  { name: 'columnOrderChanged', payloadType: 'TableColumnOrderChangedEvent', description: 'Изменился порядок колонок.' },
  { name: 'columnSizeChanged', payloadType: 'TableColumnSizeChangedEvent', description: 'Изменился размер колонки.' },
  { name: 'pageChanged', payloadType: 'TablePageChangedEvent', description: 'Изменилась страница или её размер.' },
] as const
