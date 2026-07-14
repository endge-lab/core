import type { RComponentTableColumn } from '@/domain/entities/reflect/RComponentTableColumn'
import type { PhaseExecutorContext } from '@endge/raph'
import type { RComponent } from '@/domain/types/component.types'
import type { RFilter } from '@/domain/entities/reflect/RFilter'
import type { RComposition } from '@/domain/entities/reflect/RComposition'
import type { RStore } from '@/domain/entities/reflect/RStore'
import type { RAction } from '@/domain/entities/reflect/RAction'
import type { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import type { RComponentTable } from '@/domain/entities/reflect/RComponentTable'
import type { RPage } from '@/domain/entities/reflect/RPage'
import type { RProject } from '@/domain/entities/reflect/RProject'
import type { RQuery } from '@/domain/entities/reflect/RQuery'
import type { RView } from '@/domain/entities/reflect/RView'
import type { RuntimeStrategy } from '@/model/services/runtime/RuntimeStrategy'
import type { RuntimeHostRegistrySnapshot } from '@/domain/types/runtime-registry.types'

/**
 * Runtime kinds
 */
export type RuntimeKind = 'query' | 'filter' | 'composition' | 'store' | 'table' | 'table-column' | 'action' | 'runtime'

/** Параметры legacy execute() для Raph-backed компонентов. */
export interface ExecuteOptions {
  basePath: string
  meta?: Record<string, unknown>
}

export type RuntimeExecutableModel
  = | RQuery
    | RComponentTable
    | RAction
    | RProject
    | RView
    | RPage
    | RComponent
    | RComponentSFC
    | RFilter
    | RComposition
    | RStore

export type AnyRuntimeStrategy = RuntimeStrategy<any, any>

export interface EndgeRuntimeSnapshot extends RuntimeHostRegistrySnapshot {
  generatedAt: number
}

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

export type RuntimeProfileByKind<K extends keyof RuntimeProfiles> = RuntimeProfiles[K]
export type RuntimeEventsByKind<K extends keyof RuntimeProfiles>
  = RuntimeProfileByKind<K>['events']
