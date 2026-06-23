import type { LogRecord } from '@/domain/types/debug/base.types'

/**
 * Простое in-memory хранилище логов с ограничением по количеству
 * и политикой удаления при переполнении.
 */
export class MemoryStore {
  private records: LogRecord[] = []

  constructor(
    private limit: number = 50_000,
    private overflowPolicy: 'drop-oldest' | 'drop-new' = 'drop-oldest',
  ) {}

  /**
   * Добавляет запись в буфер.
   * Если превышен лимит - применяет overflowPolicy:
   *  - 'drop-oldest': удаляет первые элементы
   *  - 'drop-new': игнорирует новую запись
   */
  push(record: LogRecord): void {
    if (this.records.length >= this.limit) {
      if (this.overflowPolicy === 'drop-oldest') {
        this.records.shift()
      } else {
        return
      }
    }
    this.records.push(record)
  }

  /**
   * Возвращает все записи (копию массива).
   */
  all(): LogRecord[] {
    return [...this.records]
  }

  /**
   * Полностью очищает буфер.
   */
  clear(): void {
    this.records = []
  }

  /**
   * Устанавливает новый лимит и политику.
   */
  setLimit(
    limit: number,
    policy: 'drop-oldest' | 'drop-new' = 'drop-oldest',
  ): void {
    this.limit = limit
    this.overflowPolicy = policy
    if (this.records.length > limit) {
      this.records.splice(0, this.records.length - limit)
    }
  }

  /**
   * Текущее количество записей.
   */
  size(): number {
    return this.records.length
  }
}
