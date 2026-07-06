import type { EndgeBootContext } from '@/domain/types/bootstrap.types'

import { Subscribable } from '@endge/utils'

/**
 * Базовый модуль федерации.
 * Все модули являются `Subscribable` и при необходимости могут уведомлять подписчиков через `notify()`.
 */
export abstract class EndgeModule extends Subscribable {
  /**
   * Подготавливает модуль до загрузки данных.
   * Используется для настройки зависимостей, клиентов, registry и базовых опций.
   * Метод можно не переопределять.
   */
  public setup(_ctx: EndgeBootContext): void | Promise<void> {}

  /**
   * Участвует в загрузке данных движка.
   * Модуль выполняет только свою часть загрузки или принятия данных.
   * Метод можно не переопределять.
   */
  public load(_ctx: EndgeBootContext): void | Promise<void> {}

  /**
   * Строит производные структуры из загруженных данных.
   * Здесь уместны normalize, validate, index и compile.
   * Метод можно не переопределять.
   */
  public build(_ctx: EndgeBootContext): void | Promise<void> {}

  /**
   * Запускает живую инфраструктуру модуля после `load/build`.
   * Здесь уместны subscriptions, runtime phases, watchers, adapters и debug hooks.
   * Метод можно не переопределять.
   */
  public start(_ctx: EndgeBootContext): void | Promise<void> {}

  /**
   * Сбрасывает runtime-состояние модуля.
   * После `reset()` федерация может быть повторно инициализирована тем же набором модулей.
   * Метод можно не переопределять.
   */
  public reset(): void | Promise<void> {}

  /**
   * Возвращает сериализуемый snapshot модуля для сохранения федерацией.
   * Если модулю нечего сохранять, можно вернуть `undefined` или не переопределять метод.
   */
  public serialize(): unknown {
    return undefined
  }

  /**
   * Восстанавливает состояние модуля из snapshot, полученного из storage федерации.
   * `undefined` означает отсутствие сохранённого состояния и должен обрабатываться как дефолтный сценарий.
   * Метод можно не переопределять.
   */
  public deserialize(_payload: unknown): void {}
}
