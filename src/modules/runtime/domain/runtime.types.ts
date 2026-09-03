import type { RAction } from '@/modules/domain/entities/RAction'
import type { RComponentSFC } from '@/modules/domain/entities/RComponentSFC'
import type { RComposition } from '@/modules/domain/entities/RComposition'
import type { RFilter } from '@/modules/domain/entities/RFilter'
import type { RPage } from '@/modules/domain/entities/RPage'
import type { RProject } from '@/modules/domain/entities/RProject'
import type { RQuery } from '@/modules/domain/entities/RQuery'
import type { RStore } from '@/modules/domain/entities/RStore'
import type { RStream } from '@/modules/domain/entities/RStream'
import type { RuntimeHostRegistrySnapshot } from '@/modules/runtime/domain/runtime-registry.types'

/**
 * Runtime kinds
 */
export type RuntimeKind = 'query' | 'filter' | 'composition' | 'store' | 'stream' | 'action' | 'runtime'

export type RuntimeExecutableModel
  = | RQuery
    | RAction
    | RProject
    | RPage
    | RComponentSFC
    | RFilter
    | RComposition
    | RStore
    | RStream

export interface EndgeRuntimeSnapshot extends RuntimeHostRegistrySnapshot {
  generatedAt: number
  scopes: import('@/modules/runtime/domain/runtime-scope.types').RuntimeScopeSnapshot[]
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
