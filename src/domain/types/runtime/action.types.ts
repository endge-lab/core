import type { EntityOrigin, EntityRef } from '@/domain/types/document/entity-management.type'

export type RuntimeActionId = string
export type RuntimeActionSurface = string

/** Stable identities of targetless Actions provided by Endge itself. */
export const BUILTIN_ACTION_IDS = {
  consoleLog: 'built-in-console-log',
} as const

/** Declarative reference accepted by interactive primitives such as MenuItem. */
export interface ActionBinding<TInput = unknown> {
  identity: RuntimeActionId
  input?: TInput
}

/** One allowed target shape. Multiple selectors are alternatives. */
export interface ActionTargetSelector {
  type: string
  identity?: string
}

/** Concrete runtime target. Database ids are intentionally not part of the contract. */
export interface ActionExecutionTarget<TValue = unknown> {
  type: string
  identity: string
  value: TValue
}

/** How an Action is executed when there is no higher-priority runtime binding. */
export type ActionImplementation
  = | { kind: 'flow' }
    | { kind: 'provider', providerKey: string }
    | { kind: 'component-port', portName: string }

export interface ActionDefinitionInput {
  identity: string
  displayName?: string
  description?: string | null
  active?: boolean
  target?: ActionTargetSelector[] | null
  input?: unknown
  output?: unknown
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
  /** Runtime catalog placement; it does not affect ownership or persistence. */
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

/** Operations implemented by one mounted Table instance. */
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
