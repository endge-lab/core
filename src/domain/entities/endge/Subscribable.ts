/** Минимальный framework-independent contract объекта с подпиской на изменения. */
export interface SubscribableLike {
  subscribe: (listener: () => void) => () => void
}

/**
 * Публикует изменения владельца состояния без зависимости от UI framework.
 */
export class Subscribable implements SubscribableLike {
  /** Подписчики текущего владельца состояния. */
  private readonly _subscribers = new Set<() => void>()

  /**
   * ----------------------------------------
   * PUBLIC
   * ----------------------------------------
   */

  /** Подписывает listener и возвращает идемпотентную функцию отписки. */
  public subscribe(listener: () => void): () => void {
    this._subscribers.add(listener)
    return () => {
      this._subscribers.delete(listener)
    }
  }

  /** Уведомляет текущих подписчиков об изменении владельца состояния. */
  public notify(): void {
    for (const listener of this._subscribers) {
      listener()
    }
  }
}
