import type { EndgeCoreEventMap } from '@/features/core/modules/events/domain/events.types'

/** Событие для applyEvent с согласованными именем и типом payload. */
export type ContextEvent = {
  [K in keyof EndgeCoreEventMap & `context:${string}`]: {
    readonly name: K
    readonly payload: EndgeCoreEventMap[K]
  }
}[keyof EndgeCoreEventMap & `context:${string}`]
