export type RuntimeCommandId = string
export type RuntimeCommandSurface = string

export interface RuntimeCommandContext {
  surface: RuntimeCommandSurface
  runtimeId?: string
  target?: unknown
}

export interface RuntimeCommand<TContext extends RuntimeCommandContext = RuntimeCommandContext, TPayload = unknown> {
  id: RuntimeCommandId
  label?: string
  description?: string
  surface?: RuntimeCommandSurface
  canExecute?: (context: TContext, payload?: TPayload) => boolean
  execute: (context: TContext, payload?: TPayload) => void | Promise<void>
}

export type AnyRuntimeCommand = RuntimeCommand<any, any>

export interface RuntimeCommandSnapshotItem {
  id: RuntimeCommandId
  label?: string
  description?: string
  surface?: RuntimeCommandSurface
}

export interface RuntimeCommandRegistrySnapshot {
  commands: RuntimeCommandSnapshotItem[]
}

export type TableColumnPinSide = 'left' | 'right' | 'none'
export type TableSortDirection = 'asc' | 'desc'
export type TableSortMode = 'multiple' | 'single' | 'fixed' | 'disabled'

export const TABLE_RUNTIME_COMMAND_IDS = {
  columnPinLeft: 'table.column.pinLeft',
  columnPinRight: 'table.column.pinRight',
  columnUnpin: 'table.column.unpin',
  sortSetColumnAsc: 'table.sort.setColumnAsc',
  sortSetColumnDesc: 'table.sort.setColumnDesc',
  sortClearColumn: 'table.sort.clearColumn',
  sortClearAll: 'table.sort.clearAll',
} as const

export type TableRuntimeCommandId = typeof TABLE_RUNTIME_COMMAND_IDS[keyof typeof TABLE_RUNTIME_COMMAND_IDS]

export interface TableColumnSortState {
  active: boolean
  direction?: TableSortDirection
  index?: number
}

export interface TableRuntimeCommandTarget {
  setColumnPin?: (columnKey: string, side: TableColumnPinSide) => void | Promise<void>
  setColumnSort?: (columnKey: string, direction: TableSortDirection) => void | Promise<void>
  clearColumnSort?: (columnKey: string) => void | Promise<void>
  clearAllSort?: () => void | Promise<void>
}

export interface TableColumnCommandContext extends RuntimeCommandContext {
  surface: 'table-column-header'
  tableRuntimeId: string
  tableId: string
  target: TableRuntimeCommandTarget
  columnKey: string
  columnIndex: number
  pinState: TableColumnPinSide
  sortable: boolean
  sortMode: TableSortMode
  sortState: TableColumnSortState
  activeSortCount: number
}
