import type { EventCallback, OneOrMany } from '@endge/utils'
import { EventBus, RingBuffer } from '@endge/utils'
import type {
  CachedEvent,
  EndgeCustomEventMap,
  EndgeEmitOptions,
} from '@/domain/types/kernel/events.types'
import { EndgeEvent } from '@/domain/types/kernel/events.types'
import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import type { EndgeCoreEventMap } from '@/model/config/events'

/**
 * Модуль событий Endge.
 * Инкапсулирует core/custom event bus и небольшой runtime-кеш последних событий.
 */
export class EndgeEvents extends EndgeModule {
  // 0 - кеш отключён
  public static EVENTS_CACHE_SIZE = 0

  private readonly _bus: EventBus<EndgeCoreEventMap, EndgeCustomEventMap>

  // делаем изменяемым (не readonly), чтобы можно было пересоздавать
  private _cache: RingBuffer<CachedEvent> | null

  /**
   * Создает event bus с заранее известными core-событиями.
   */
  constructor(predefinedEvents: (keyof EndgeCoreEventMap & string)[] = []) {
    super()
    this._bus = new EventBus<EndgeCoreEventMap, EndgeCustomEventMap>(
      predefinedEvents as (keyof EndgeCoreEventMap)[],
    )
    this._cache = this.makeCache(EndgeEvents.EVENTS_CACHE_SIZE)
  }

  /**
   * Изменяет размер кеша последних событий для текущего экземпляра.
   */
  public setCacheSize(next: number): void {
    const n = Math.max(0, Math.floor(Number(next) || 0))
    EndgeEvents.EVENTS_CACHE_SIZE = n

    const prev = this._cache
    if (n === 0) {
      this._cache = null
      if (prev?.length) this.notify()
      return
    }

    // пересоздаём, сохраняя хвост (самые свежие)
    const nextCache = new RingBuffer<CachedEvent>(n)
    if (prev) {
      const old: CachedEvent[] = prev.toArray() // От старых событий к новым.
      const tail: CachedEvent[] = old.slice(Math.max(0, old.length - n))
      for (const item of tail) nextCache.push(item)
    }
    this._cache = nextCache
    this.notify()
  }

  /**
   * Внутренний helper модуля: make Cache.
   */
  private makeCache(n: number): RingBuffer<CachedEvent> | null {
    const size = Math.max(0, Math.floor(Number(n) || 0))
    return size > 0 ? new RingBuffer<CachedEvent>(size) : null
  }

  /**
   * Возвращает текущую емкость кеша событий.
   */
  public get cacheSize(): number {
    return this._cache?.capacity ?? 0
  }

  /**
   * Возвращает количество событий, сохраненных в кеше.
   */
  public get cachedCount(): number {
    return this._cache?.length ?? 0
  }

  /**
   * Возвращает снимок кеша событий от старых к новым.
   */
  public get lastEvents(): CachedEvent[] {
    return this._cache?.toArray() ?? []
  }

  /**
   * Очищает кеш последних событий.
   */
  public clearCache(): void {
    this._cache?.clear()
    this.notify()
  }

  /**
   * Подписывает обработчик на типизированные core-события Endge.
   */
  onEvent<K extends keyof EndgeCoreEventMap & string>(
    events: OneOrMany<K>,
    callback: (e: EndgeEvent<EndgeCoreEventMap[K]>) => void,
  ): () => void {
    const handler: EventCallback<EndgeCoreEventMap[K]> = (payload) =>
      callback(new EndgeEvent(payload))

    this._bus.on(events, handler)
    return () => this._bus.off(events, handler)
  }

  /**
   * Публикует типизированное core-событие Endge.
   */
  emitEvent<K extends keyof EndgeCoreEventMap & string>(
    event: K,
    payload: EndgeCoreEventMap[K],
    opts: EndgeEmitOptions = {},
  ): EndgeEvent<EndgeCoreEventMap[K]> {
    const e = new EndgeEvent(payload)

    this._bus.emit(event, payload)
    void opts

    this._cache?.push({ name: event, payload, at: Date.now() })
    this.notify()

    return e
  }

  /**
   * Подписывает обработчик на динамические пользовательские события.
   */
  onDynamic<K extends keyof EndgeCustomEventMap & string>(
    events: OneOrMany<K>,
    callback: (e: EndgeEvent<EndgeCustomEventMap[K]>) => void,
  ): () => void {
    const handler: EventCallback<EndgeCustomEventMap[K]> = (payload) =>
      callback(new EndgeEvent(payload))

    this._bus.onCustom(events, handler)
    return () => this._bus.offCustom(events, handler)
  }

  /**
   * Публикует динамическое пользовательское событие.
   */
  emitDynamic<K extends keyof EndgeCustomEventMap & string>(
    event: K,
    payload: EndgeCustomEventMap[K],
    opts: EndgeEmitOptions = {},
  ): EndgeEvent<EndgeCustomEventMap[K]> {
    const e = new EndgeEvent(payload)

    this._bus.emitCustom(event, payload)
    void opts

    this._cache?.push({ name: event, payload, at: Date.now() })
    this.notify()

    return e
  }

  /**
   * Подписывает raw-callback на core-события без обертки EndgeEvent.
   */
  public on<K extends keyof EndgeCoreEventMap & string>(
    events: OneOrMany<K>,
    callback: EventCallback<EndgeCoreEventMap[K]>,
  ): void {
    this._bus.on(events, callback)
  }

  /**
   * Снимает raw-callback с core-событий.
   */
  public off<K extends keyof EndgeCoreEventMap & string>(
    events: OneOrMany<K>,
    callback: EventCallback<EndgeCoreEventMap[K]>,
  ): void {
    this._bus.off(events, callback)
  }

  /**
   * Подписывает raw-callback на пользовательские события.
   */
  public onCustom<K extends keyof EndgeCustomEventMap & string>(
    events: OneOrMany<K>,
    callback: EventCallback<EndgeCustomEventMap[K]>,
  ): void {
    this._bus.onCustom(events, callback)
  }

  /**
   * Снимает raw-callback с пользовательских событий.
   */
  public offCustom<K extends keyof EndgeCustomEventMap & string>(
    events: OneOrMany<K>,
    callback: EventCallback<EndgeCustomEventMap[K]>,
  ): void {
    this._bus.offCustom(events, callback)
  }
}
