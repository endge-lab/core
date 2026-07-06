import { EndgeModule } from '@/domain/entities/endge/EndgeModule'

/**
 * Простой key-value store с подписками по ключам и глобальными подписками.
 */
export class EndgeStore extends EndgeModule {
  static Default = 'default'

  // Основное хранилище: storeKey -> данные
  private state: Map<string, any> = new Map()

  // Подписчики: storeKey -> Set of listeners
  private keyedSubscribers: Map<string, Set<() => void>> = new Map()
  private globalSubscribers: Set<(key: string) => void> = new Set()

  /**
   * Создает default store bucket.
   */
  constructor() {
    super()
    this.state.set(EndgeStore.Default, null)
  }

  /**
   * Подписка на изменения по ключу store.
   * @param storeKey Ключ стора
   * @param listener Колбэк на обновление
   * @returns Функция отписки
   */
  public subscribe(listener: () => void): () => void
  public subscribe(storeKey: string, listener: () => void): () => void
  public subscribe(
    storeKeyOrListener: string | (() => void),
    listener?: () => void,
  ): () => void {
    if (typeof storeKeyOrListener === 'function')
      return super.subscribe(storeKeyOrListener)

    const storeKey = storeKeyOrListener
    const handler = listener
    if (!handler)
      return () => {}

    if (!this.keyedSubscribers.has(storeKey)) {
      this.keyedSubscribers.set(storeKey, new Set())
    }

    this.keyedSubscribers.get(storeKey)!.add(handler)

    return () => {
      this.keyedSubscribers.get(storeKey)!.delete(handler)
    }
  }

  /**
   * Подписка на любые изменения (любой storeKey)
   */
  public subscribeAll(listener: (storeKey: string) => void): () => void {
    this.globalSubscribers.add(listener)
    return () => this.globalSubscribers.delete(listener)
  }

  /**
   * Обновляет данные стора и уведомляет подписчиков этого стора.
   * @param storeKey Ключ стора
   * @param newData Новые данные
   */
  public updateState(storeKey: string, newData: any): void {
    this.state.set(storeKey, newData)
    this.notify(storeKey)
  }

  /**
   * Возвращает состояние указанного стора.
   * @param storeKey Ключ стора (по умолчанию "default")
   */
  public getState(storeKey: string = EndgeStore.Default): any {
    if (!this.state.has(storeKey)) {
      this.state.set(storeKey, new Map())
    }
    return this.state.get(storeKey)!
  }

  /**
   * Возвращает состояния всех сторов.
   */
  public getStates(): Map<string, any> {
    return this.state
  }

  /**
   * Уведомляет подписчиков определённого стора.
   * @param storeKey Ключ стора
   */
  public notify(): void
  public notify(storeKey: string): void
  public notify(storeKey: string = EndgeStore.Default): void {
    const keyedListeners = this.keyedSubscribers.get(storeKey)
    if (keyedListeners) {
      keyedListeners.forEach((listener) => listener())
    }

    this.globalSubscribers.forEach((listener) => listener(storeKey))
    super.notify()
  }
}
