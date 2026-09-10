import type { RuntimeHostStatus } from '@/features/core/modules/runtime/domain/runtime-host.types'
import type { EndgeDataMode } from '@/features/core/modules/workspace/domain/workspace.types'

/** Связка события и identity действия из Domain. */
export interface EndgeEventBinding {
  event: string
  actionId: string | null
}

export interface ContextValueChange<T> {
  readonly previous: T
  readonly value: T
}

/** Статические события Endge Core о фактически произошедших изменениях. */
export interface EndgeCoreEventMap {
  'context:workspace-changed': ContextValueChange<string | null>
  'context:tenant-changed': ContextValueChange<string>
  'context:project-changed': ContextValueChange<string>
  'context:environment-changed': ContextValueChange<string>
  'context:user-changed': ContextValueChange<string>
  'context:locale-changed': ContextValueChange<string>
  'context:theme-changed': ContextValueChange<string>
  'context:timezone-changed': ContextValueChange<string>
  'context:data-mode-changed': ContextValueChange<EndgeDataMode>
  'runtime:data-changed': { readonly revision: number }
  'runtime:registry-changed': Record<string, never>
  'runtime:scopes-changed': Record<string, never>
  'runtime:host-status-changed': { readonly id: string, readonly previous: RuntimeHostStatus, readonly value: RuntimeHostStatus }
  'updates:message': { type: string, message: unknown }
  'updates:applied': { identity: string, count: number }
}

export interface EndgeCustomEventMap {
  [event: string]: unknown
}

/** Уведомление о свершившемся факте не отменяет операцию owner-а. */
export interface EndgeEvent<T> {
  readonly payload: T
}

/** Метаданные одной публикации. Историю хранит потребитель, а не шина. */
export interface EndgePublishedEvent<T = unknown> extends EndgeEvent<T> {
  readonly name: string
  readonly at: number
  readonly sequence: number
}
