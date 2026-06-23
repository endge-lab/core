import type { RComponentTableColumn } from '@/domain/entities/reflect/RComponentTableColumn'
import type { PhaseExecutorContext } from '@endge/raph'

/**
 * Runtime kinds
 */
export type RuntimeKind = 'query' | 'table' | 'table-column' | 'action' | 'runtime'

/**
 * Событие для query: изменение фильтра
 */
export interface FilterChangeEvent {
  filterId: string
}

/**
 * Query runtime events
 */
export interface QueryRuntimeEvents {
  'filter:change': FilterChangeEvent
}

export interface TableCellEvent<Row = any> {
  /** Нативное DOM-событие */
  event?: Event

  /** Колонка */
  column: RComponentTableColumn
  columnIndex: number

  /** Строка */
  rowIndex: number
  row: Row
}

export interface TableCellsUpdateEvent {
  children: Array<{
    node: {
      meta?: {
        columnIndex?: number
        columnId?: string | number
      }
    }
    events?: PhaseExecutorContext['events']
  }>
}

/**
 * Table runtime events (всё что было + filter:change)
 */
export interface TableRuntimeEvents {
  // системные апдейты таблицы
  'update:root': {
    events?: unknown[]
    meta?: Record<string, unknown>
  }
  'update:cells': TableCellsUpdateEvent
  'update:boundaries': { children: PhaseExecutorContext[] }

  // события колонок
  'table-cell:click': TableCellEvent
  'table-cell:dblclick': TableCellEvent
  'table-cell:contextmenu': TableCellEvent
  'table-cell:mousedown': TableCellEvent
  'table-cell:mouseup': TableCellEvent
}

export interface ActionRuntimeEvents {
  'source:change': {
    events?: unknown[]
    meta?: Record<string, unknown>
  }
  'step:start': {
    stepId: string
    runtimeId?: string | null
    actionId?: string | null
    title?: string | null
    meta?: Record<string, unknown>
  }
  'step:success': {
    stepId: string
    runtimeId?: string | null
    actionId?: string | null
    title?: string | null
    output?: unknown
    meta?: Record<string, unknown>
  }
  'step:error': {
    stepId: string
    runtimeId?: string | null
    actionId?: string | null
    title?: string | null
    error: unknown
    meta?: Record<string, unknown>
  }
}

/**
 * Runtime profile types
 */
export interface RuntimeProfile<
  K extends RuntimeKind,
  E extends Record<string, any>,
> {
  kind: K
  events: E
}

/**
 * Profiles registry
 */
export interface RuntimeProfiles {
  table: RuntimeProfile<'table', TableRuntimeEvents>
  query: RuntimeProfile<'query', QueryRuntimeEvents>
  action: RuntimeProfile<'action', ActionRuntimeEvents>
}

export type RuntimeProfileByKind<K extends RuntimeKind> = RuntimeProfiles[K]
export type RuntimeEventsByKind<K extends RuntimeKind>
  = RuntimeProfileByKind<K>['events']
