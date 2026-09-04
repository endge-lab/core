import type { EntityOrigin, EntityRef } from '@/modules/domain/types/document/entity-management.type'

export type RuntimeActionId = string
export type RuntimeActionSurface = string

/** Стабильные идентификаторы Actions без цели, предоставляемых самим Endge. */
export const BUILTIN_ACTION_IDS = {
  consoleLog: 'built-in-console-log',
  testAlert: 'built-in-test-alert',
  vocabAcquire: 'built-in-vocabs-acquire',
  vocabRefresh: 'built-in-vocabs-refresh',
  vocabInvalidate: 'built-in-vocabs-invalidate',
} as const

/** Декларативная ссылка, принимаемая интерактивными примитивами, например MenuItem. */
export interface ActionBinding<TInput = unknown> {
  identity: RuntimeActionId
  input?: TInput
}

/** Одна допустимая форма цели. Несколько селекторов являются альтернативами. */
export interface ActionTargetSelector {
  type: string
  identity?: string
}

/** Конкретная runtime-цель. ID базы данных намеренно не входят в контракт. */
export interface ActionExecutionTarget<TValue = unknown> {
  type: string
  identity: string
  value: TValue
}

/** Способ выполнения Action при отсутствии runtime-binding с более высоким приоритетом. */
export type ActionImplementation
  = | { kind: 'source' }
    | { kind: 'provider', providerKey: string }
    | { kind: 'component-port', portName: string }

export interface ActionDefinitionInput {
  identity: string
  displayName?: string
  description?: string | null
  active?: boolean
  target?: ActionTargetSelector[] | null
  contract?: { input?: unknown, output?: unknown }
  defaultProviderKey?: string
  defaultImplementation?: ActionImplementation
  owner?: EntityRef
}

export interface ActionExecuteOptions<TInput = unknown> {
  input?: TInput
  target?: ActionExecutionTarget
  context?: Record<string, unknown>
  resolution?: Partial<Record<Exclude<ImplementationBindingScope, 'default'>, string>>
  providerKey?: string
}

export interface ResolvedActionDescriptor {
  identity: string
  displayName: string
  description: string | null
  active: boolean
  origin: EntityOrigin
  /** Размещение в runtime-каталоге; оно не влияет на ownership или persistence. */
  catalogPath?: string[]
  owner?: EntityRef
  target: ActionTargetSelector[] | null
  input: unknown | null
  output: unknown | null
  defaultImplementation: ActionImplementation
  overridden: boolean
  effectiveProviderKey: string | null
  effectiveProviderOrigin: EntityOrigin | null
  bindingScope: ImplementationBindingScope | null
}

export type ImplementationBindingScope
  = 'default'
    | 'application'
    | 'workspace'
    | 'composition'
    | 'component'
    | 'invocation'

/** Нейтральный к renderer контекст, передаваемый runtime-провайдеру Action. */
export interface RuntimeActionContext {
  surface: RuntimeActionSurface
  runtimeId?: string
  target?: unknown
}

/** Вызываемое runtime-поведение. В отличие от Event, Action имеет одного провайдера и может вернуть результат. */
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
  columnHide: 'table.column.hide',
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

/** Операции, реализованные одним смонтированным экземпляром Table. */
export interface TableRuntimeActionTarget {
  setColumnVisibility?: (columnKey: string, visible: boolean) => void | Promise<void>
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
  hideable: boolean
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

export interface TableActionTableContext {
  id: string
  runtimeId: string
  state: Readonly<Record<string, unknown>>
}

export interface TableActionRowContext {
  id: string
  index: number
  data: Record<string, unknown>
}

export interface TableActionColumnContext {
  key: string
  index: number
  title: string
  metadata: Readonly<Record<string, unknown>>
}

export interface TableActionCellContext {
  value: unknown
}

/** Нейтральный к renderer контекст ячейки, общий для всех адаптеров меню Table. */
export interface TableRowActionContext extends RuntimeActionContext {
  /** Значение поверхности совместимости, сохранённое для существующих провайдеров Action. */
  surface: 'table-row'
  table: TableActionTableContext
  rowContext: TableActionRowContext
  column: TableActionColumnContext
  cell: TableActionCellContext
  tableRuntimeId: string
  tableId: string
  target: TableRuntimeActionTarget
  row: Record<string, unknown>
  rowId: string
  rowIndex: number
  columnKey: string
  value: unknown
}

/** Каноническое имя для новых consumers; TableRowActionContext сохраняет совместимость Source. */
export type TableCellActionContext = TableRowActionContext
