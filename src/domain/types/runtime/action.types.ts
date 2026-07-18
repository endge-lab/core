export type RuntimeActionId = string
export type RuntimeActionSurface = string

/** Renderer-neutral context passed to a runtime Action provider. */
export interface RuntimeActionContext {
  surface: RuntimeActionSurface
  runtimeId?: string
  target?: unknown
}

/** Callable runtime behavior. Unlike Event, Action has one provider and may return a result. */
export interface RuntimeAction<TContext extends RuntimeActionContext = RuntimeActionContext, TPayload = unknown, TResult = void> {
  id: RuntimeActionId
  label?: string
  description?: string
  surface?: RuntimeActionSurface
  canExecute?: (context: TContext, payload?: TPayload) => boolean
  execute: (context: TContext, payload?: TPayload) => TResult | Promise<TResult>
}

export type AnyRuntimeAction = RuntimeAction<any, any, any>

export interface RuntimeActionSnapshotItem {
  id: RuntimeActionId
  label?: string
  description?: string
  surface?: RuntimeActionSurface
}

export interface RuntimeActionRegistrySnapshot {
  actions: RuntimeActionSnapshotItem[]
}

export type TableColumnPinSide = 'left' | 'right' | 'none'
export type TableSortDirection = 'asc' | 'desc'
export type TableSortMode = 'multiple' | 'single' | 'fixed' | 'disabled'

export const TABLE_RUNTIME_ACTION_IDS = {
  columnPinLeft: 'table.column.pinLeft',
  columnPinRight: 'table.column.pinRight',
  columnUnpin: 'table.column.unpin',
  columnResetPin: 'table.column.resetPin',
  columnResetAllPins: 'table.column.resetAllPins',
  sortSetColumnAsc: 'table.sort.setColumnAsc',
  sortSetColumnDesc: 'table.sort.setColumnDesc',
  sortClearColumn: 'table.sort.clearColumn',
  sortClearAll: 'table.sort.clearAll',
} as const

export type TableRuntimeActionId = typeof TABLE_RUNTIME_ACTION_IDS[keyof typeof TABLE_RUNTIME_ACTION_IDS]

export interface TableColumnSortState {
  active: boolean
  direction?: TableSortDirection
  index?: number
}

/** Operations implemented by one mounted Table instance. */
export interface TableRuntimeActionTarget {
  setColumnPin?: (columnKey: string, side: TableColumnPinSide) => void | Promise<void>
  resetColumnPin?: (columnKey: string) => void | Promise<void>
  resetAllPins?: () => void | Promise<void>
  setColumnSort?: (columnKey: string, direction: TableSortDirection) => void | Promise<void>
  clearColumnSort?: (columnKey: string) => void | Promise<void>
  clearAllSort?: () => void | Promise<void>
}

export interface TableColumnActionContext extends RuntimeActionContext {
  surface: 'table-column-header'
  tableRuntimeId: string
  tableId: string
  target: TableRuntimeActionTarget
  columnKey: string
  columnIndex: number
  pinnable: boolean
  pinMode: 'enabled' | 'disabled'
  pinState: TableColumnPinSide
  defaultPinState: TableColumnPinSide
  hasPinChanges: boolean
  sortable: boolean
  sortMode: TableSortMode
  sortState: TableColumnSortState
  activeSortCount: number
}
