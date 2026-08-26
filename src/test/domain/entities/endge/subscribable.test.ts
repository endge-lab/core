import { describe, expect, it, vi } from 'vitest'

import { Subscribable } from '@/domain/entities/endge/Subscribable'

describe('Subscribable', () => {
  /** Проверяет публикацию изменения всем активным подписчикам. */
  it('уведомляет каждого активного подписчика', () => {
    const subscribable = new Subscribable()
    const first = vi.fn()
    const second = vi.fn()

    subscribable.subscribe(first)
    subscribable.subscribe(second)
    subscribable.notify()

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
  })

  /** Проверяет, что отписанный consumer больше не получает изменения. */
  it('прекращает уведомления после отписки', () => {
    const subscribable = new Subscribable()
    const listener = vi.fn()
    const unsubscribe = subscribable.subscribe(listener)

    unsubscribe()
    unsubscribe()
    subscribable.notify()

    expect(listener).not.toHaveBeenCalled()
  })
})
