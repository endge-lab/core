/**
 * Связка события и id Действия из домена
 */
export type EndgeEventBinding = {
  event: string
  actionId: string | null
}

export type AnyEventName = string
export type AnyPayload = unknown

export type CachedEvent = {
  name: AnyEventName
  payload: AnyPayload
  at: number
}

//
//
export interface EndgeCustomEventMap {
  [event: string]: unknown
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
