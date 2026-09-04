import { describe, expect, it, vi } from 'vitest'
import { OperationHistory } from '@/modules/runtime/operation/operation-history'

describe('история операций', () => {
  it('последовательно выполняет undo/redo и обрезает ветку redo после новой фиксации', async () => {
    const calls: string[] = []
    const history = new OperationHistory({ id: 'history', limit: 2 })
    history.commit({ id: 'one', input: {}, runOutput: null, undo: async () => calls.push('undo-one'), redo: async () => calls.push('redo-one') })
    history.commit({ id: 'two', input: {}, runOutput: null, undo: async () => calls.push('undo-two'), redo: async () => calls.push('redo-two') })
    await history.undo()
    expect(history.canRedo()).toBe(true)
    history.commit({ id: 'three', input: {}, runOutput: null, undo: async () => calls.push('undo-three'), redo: async () => calls.push('redo-three') })
    expect(history.canRedo()).toBe(false)
    expect(calls).toEqual(['undo-two'])
  })

  it('сохраняет позицию при ошибке undo или redo', async () => {
    const history = new OperationHistory({ id: 'history' })
    history.commit({ id: 'failed', input: {}, runOutput: null, undo: async () => {
      throw new Error('no')
    }, redo: vi.fn() })
    await expect(history.undo()).rejects.toThrow('no')
    expect(history.canUndo()).toBe(true)
    expect(history.canRedo()).toBe(false)
  })

  it('удаляет самые старые зафиксированные записи при уменьшении лимита', () => {
    const history = new OperationHistory({ id: 'history', limit: 3 })
    for (let index = 0; index < 3; index++) {
      history.commit({ id: String(index), input: {}, runOutput: null, undo: vi.fn(), redo: vi.fn() })
    }
    history.setLimit(1)
    expect(history.snapshot()).toMatchObject({ size: 1, cursor: 1, limit: 1 })
  })
})
