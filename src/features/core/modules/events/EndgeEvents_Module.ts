import type { EventCallback, OneOrMany } from '@endge/utils'
import type {
  EndgeCoreEventMap,
  EndgeCustomEventMap,
  EndgeEvent,
  EndgePublishedEvent,
} from '@/features/core/modules/events/domain/events.types'
import { EventBus } from '@endge/utils'
import { EndgeModule } from '@/features/federation/EndgeModule'

/** Синхронная шина Core: только подписки, без кеша событий и очереди доставки. */
export class EndgeEvents_Module extends EndgeModule {
  private readonly _bus = new EventBus<EndgeCoreEventMap, EndgeCustomEventMap>([], {
    onListenerError: (error, name) => this._reportListenerError(error, name),
  })

  private readonly _observers = new EventBus<{ event: EndgePublishedEvent }>([], {
    onListenerError: error => this._reportListenerError(error, 'onAny'),
  })

  private _sequence = 0

  /** Подписывает наблюдателя на все последующие публикации. */
  public onAny(callback: (event: EndgePublishedEvent) => void): () => void {
    this._observers.on('event', callback)
    return () => this._observers.off('event', callback)
  }

  public onEvent<K extends keyof EndgeCoreEventMap & string>(
    events: OneOrMany<K>,
    callback: (event: EndgeEvent<EndgeCoreEventMap[K]>) => void,
  ): () => void {
    const handler: EventCallback<EndgeCoreEventMap[K]> = payload => callback({ payload })
    this._bus.on(events, handler)
    return () => this._bus.off(events, handler)
  }

  public emitEvent<K extends keyof EndgeCoreEventMap & string>(
    name: K,
    payload: EndgeCoreEventMap[K],
  ): EndgePublishedEvent<EndgeCoreEventMap[K]> {
    const event = this._publish(name, payload)
    this._bus.emit(name, payload)
    return event
  }

  public onDynamic<K extends keyof EndgeCustomEventMap & string>(
    events: OneOrMany<K>,
    callback: (event: EndgeEvent<EndgeCustomEventMap[K]>) => void,
  ): () => void {
    const handler: EventCallback<EndgeCustomEventMap[K]> = payload => callback({ payload })
    this._bus.onCustom(events, handler)
    return () => this._bus.offCustom(events, handler)
  }

  public emitDynamic<K extends keyof EndgeCustomEventMap & string>(
    name: K,
    payload: EndgeCustomEventMap[K],
  ): EndgePublishedEvent<EndgeCustomEventMap[K]> {
    const event = this._publish(name, payload)
    this._bus.emitCustom(name, payload)
    return event
  }

  public on<K extends keyof EndgeCoreEventMap & string>(events: OneOrMany<K>, callback: EventCallback<EndgeCoreEventMap[K]>): void {
    this._bus.on(events, callback)
  }

  public off<K extends keyof EndgeCoreEventMap & string>(events: OneOrMany<K>, callback: EventCallback<EndgeCoreEventMap[K]>): void {
    this._bus.off(events, callback)
  }

  public onCustom<K extends keyof EndgeCustomEventMap & string>(events: OneOrMany<K>, callback: EventCallback<EndgeCustomEventMap[K]>): void {
    this._bus.onCustom(events, callback)
  }

  public offCustom<K extends keyof EndgeCustomEventMap & string>(events: OneOrMany<K>, callback: EventCallback<EndgeCustomEventMap[K]>): void {
    this._bus.offCustom(events, callback)
  }

  public override reset(): void {
    this._bus.clear()
    this._observers.clear()
  }

  private _publish<T>(name: string, payload: T): EndgePublishedEvent<T> {
    const event = Object.freeze({ name, payload, at: Date.now(), sequence: ++this._sequence })
    this._observers.emit('event', event)
    return event
  }

  private _reportListenerError(error: unknown, name: string): void {
    // Не публикуем ошибку обратно в Events, чтобы исключить рекурсию наблюдателей.
    console.error(`[EndgeEvents] Listener failed for "${name}"`, error)
  }
}
