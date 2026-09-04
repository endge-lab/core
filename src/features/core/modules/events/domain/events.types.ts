/**
 * Связка события и id Действия из домена
 */
export interface EndgeEventBinding {
  event: string
  actionId: string | null
}

export type AnyEventName = string
export type AnyPayload = unknown

export interface CachedEvent {
  name: AnyEventName
  payload: AnyPayload
  at: number
}

//
//
export interface EndgeCustomEventMap {
  [event: string]: unknown
}

/** Статические события Endge Core. */
export interface EndgeCoreEventMap {
  'updates:message': { type: string, message: unknown }
  'updates:applied': { identity: string, count: number }
}

//
//
export interface EndgeEmitOptions {
  stopOnCancel?: boolean
}

/**
 * Envelope-событие с возможностью cancel()
 */
export class EndgeEvent<T> {
  public isCanceled: boolean = false

  constructor(public readonly payload: T) {}

  cancel(): void {
    this.isCanceled = true
  }
}
