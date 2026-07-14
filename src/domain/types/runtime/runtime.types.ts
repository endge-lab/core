import type { RFilter } from '@/domain/entities/reflect/RFilter'
import type { RComposition } from '@/domain/entities/reflect/RComposition'
import type { RStore } from '@/domain/entities/reflect/RStore'
import type { RAction } from '@/domain/entities/reflect/RAction'
import type { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import type { RPage } from '@/domain/entities/reflect/RPage'
import type { RProject } from '@/domain/entities/reflect/RProject'
import type { RQuery } from '@/domain/entities/reflect/RQuery'
import type { RView } from '@/domain/entities/reflect/RView'
import type { RuntimeHostRegistrySnapshot } from '@/domain/types/runtime/runtime-registry.types'

/**
 * Runtime kinds
 */
export type RuntimeKind = 'query' | 'filter' | 'composition' | 'store' | 'action' | 'runtime'

export type RuntimeExecutableModel
  = | RQuery
    | RAction
    | RProject
    | RView
    | RPage
    | RComponentSFC
    | RFilter
    | RComposition
    | RStore

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
  query: RuntimeProfile<'query', QueryRuntimeEvents>
  action: RuntimeProfile<'action', ActionRuntimeEvents>
}

export type RuntimeProfileByKind<K extends keyof RuntimeProfiles> = RuntimeProfiles[K]
export type RuntimeEventsByKind<K extends keyof RuntimeProfiles>
  = RuntimeProfileByKind<K>['events']
