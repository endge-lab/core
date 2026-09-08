import { describe, expect, it, vi } from 'vitest'
import { executeRuntimeOperation } from '@/features/core/modules/runtime/operation/operation-executor'
import { OperationHistory } from '@/features/core/modules/runtime/operation/operation-history'

describe('история операций', () => {
  it('serializes the entire next run and commit behind an in-flight undo', async () => {
    const history = new OperationHistory({ id: 'history' })
    let value = 0
    let finishUndo!: () => void
    await executeRuntimeOperation({
      id: 'first',
      input: {},
      history,
      recordHistory: true,
      run: async () => {
        value = 1
      },
      undo: async () => {
        await new Promise<void>((resolve) => {
          finishUndo = resolve
        })
        value = 0
      },
    })
    const undo = history.undo()
    await vi.waitFor(() => expect(finishUndo).toBeTypeOf('function'))
    const run = vi.fn(async () => {
      value = 2
    })
    const next = executeRuntimeOperation({ id: 'next', input: {}, history, recordHistory: true, run, undo: async () => {
      value = 0
    } })
    await Promise.resolve()
    expect(run).not.toHaveBeenCalled()
    finishUndo()
    await Promise.all([undo, next])
    expect(value).toBe(2)
    expect(history.snapshot()).toMatchObject({ size: 1, cursor: 1 })
    expect(history.canRedo()).toBe(false)
    await history.undo()
    expect(value).toBe(0)
    await history.redo()
    expect(value).toBe(2)
  })

  it('does not resurrect the cursor after disposal during undo', async () => {
    const history = new OperationHistory({ id: 'history' })
    let finish!: () => void
    await history.commit({ id: 'one', input: {}, runOutput: null, undo: () => new Promise<void>((resolve) => {
      finish = resolve
    }), redo: vi.fn() })
    const pending = history.undo()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    history.dispose()
    finish()
    await pending
    expect(history.snapshot()).toMatchObject({ size: 0, cursor: 0 })
  })

  it('последовательно выполняет undo/redo и обрезает ветку redo после новой фиксации', async () => {
    const calls: string[] = []
    const history = new OperationHistory({ id: 'history', limit: 2 })
    await history.commit({ id: 'one', input: {}, runOutput: null, undo: async () => calls.push('undo-one'), redo: async () => calls.push('redo-one') })
    await history.commit({ id: 'two', input: {}, runOutput: null, undo: async () => calls.push('undo-two'), redo: async () => calls.push('redo-two') })
    await history.undo()
    expect(history.canRedo()).toBe(true)
    await history.commit({ id: 'three', input: {}, runOutput: null, undo: async () => calls.push('undo-three'), redo: async () => calls.push('redo-three') })
    expect(history.canRedo()).toBe(false)
    expect(calls).toEqual(['undo-two'])
  })

  it('сохраняет позицию при ошибке undo или redo', async () => {
    const history = new OperationHistory({ id: 'history' })
    await history.commit({ id: 'failed', input: {}, runOutput: null, undo: async () => {
      throw new Error('no')
    }, redo: vi.fn() })
    await expect(history.undo()).rejects.toThrow('no')
    expect(history.canUndo()).toBe(true)
    expect(history.canRedo()).toBe(false)
  })

  it('удаляет самые старые зафиксированные записи при уменьшении лимита', async () => {
    const history = new OperationHistory({ id: 'history', limit: 3 })
    for (let index = 0; index < 3; index++) {
      await history.commit({ id: String(index), input: {}, runOutput: null, undo: vi.fn(), redo: vi.fn() })
    }
    history.setLimit(1)
    expect(history.snapshot()).toMatchObject({ size: 1, cursor: 1, limit: 1 })
  })
})
