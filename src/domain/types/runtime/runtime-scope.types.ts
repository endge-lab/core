import type { RuntimeHost } from '@/domain/types/runtime/runtime-host.types'
import type { RuntimeResourceBagSnapshot } from '@/domain/types/runtime/runtime-resource.types'

export type RuntimeScopeState
  = | 'inactive'
    | 'activating'
    | 'active'
    | 'pausing'
    | 'paused'
    | 'resuming'
    | 'deactivating'
    | 'error'
    | 'disposed'

export interface RuntimeScopeSnapshot {
  id: string
  path: string
  parentScopeId: string | null
  ownerRuntimeId: string | null
  boundaryId: string
  state: RuntimeScopeState
  generation: number
  stale: boolean
  updateGateOpen: boolean
  childScopeIds: string[]
  memberRuntimeIds: string[]
  resources: RuntimeResourceBagSnapshot
  lastError: string | null
}

export interface RuntimeScopeHandle {
  readonly id: string
  readonly path: string
  readonly state: RuntimeScopeState
  readonly boundaryId: string
  activate: () => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  deactivate: () => Promise<void>
  dispose: () => Promise<void>
  getRuntime: (path: string) => RuntimeHost<any, any> | null
  getOutput: (name: string) => unknown
  snapshot: () => RuntimeScopeSnapshot
}

export interface RuntimeScopeLifecycleHooks {
  activate?: (signal: AbortSignal, generation: number) => Promise<void> | void
  pause?: () => Promise<void> | void
  resume?: () => Promise<void> | void
  reconcile?: () => Promise<void> | void
  deactivate?: () => Promise<void> | void
  dispose?: () => Promise<void> | void
  /** Centralized teardown keeps RuntimeHostRegistry and scope indexes consistent. */
  destroyRuntime?: (runtimeId: string) => Promise<void> | void
  resolveRuntime?: (path: string) => RuntimeHost<any, any> | null
  resolveOutput?: (name: string) => unknown
}
