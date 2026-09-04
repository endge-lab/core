/**
 * Базовая оболочка события, которую можно "отменить".
 * Отмена может быть использована эмиттером для stopPropagation.
 */
export interface EndgeEventBase<T = unknown> {
  readonly isCanceled: boolean
  readonly payload: T
  cancel: () => void
}

/**
 * Базовый класс события (cancellable envelope).
 */
export class EndgeEvent<T> implements EndgeEventBase<T> {
  public isCanceled = false

  constructor(public readonly payload: T) {}

  cancel(): void {
    this.isCanceled = true
  }
}

/**
 * Опции эмита (для stopPropagation).
 */
export interface EndgeEmitOptions {
  /**
   * Если true - прекращает вызов следующих слушателей после cancel().
   */
  stopOnCancel?: boolean
}

/**
 * События ядра (строго типизированные) - подставь свой интерфейс payloads.
 * Например:
 * export interface EndgeEventPayloads { 'app:init': {}; ... }
 */
export type EndgeEventPayloads = Record<string, unknown>
