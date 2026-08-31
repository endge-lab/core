import type { RQuery } from '@/domain/entities/reflect/RQuery'
import type { ActionProgramExecutorDependencies } from '@/model/modules/runtime/execution/action/action-program-executor'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ActionProgramExecutor } from '@/model/modules/runtime/execution/action/action-program-executor'
import { OperationHistory } from '@/model/modules/runtime/operation/operation-history'
import { compileActionSource } from '@/model/services/source-engine/compilers/action-source-compile'

function unsupportedDependency(): never {
  throw new Error('Unexpected ActionProgramExecutor dependency call.')
}

function createExecutor(overrides: Partial<ActionProgramExecutorDependencies> = {}): ActionProgramExecutor {
  return new ActionProgramExecutor({
    resolveQuery: () => null,
    runQuery: async () => unsupportedDependency(),
    executeAction: async () => unsupportedDependency(),
    runComputation: async () => unsupportedDependency(),
    executeSandbox: async () => unsupportedDependency(),
    resolveOperationHistory: () => null,
    runDataView: () => unsupportedDependency(),
    executeConverter: () => unsupportedDependency(),
    ...overrides,
  })
}

describe('actionProgramExecutor', () => {
  afterEach(() => vi.restoreAllMocks())

  it('executes named steps sequentially and publishes only explicit output', async () => {
    const compiled = compileActionSource({ source: `defineAction({
      steps: {
        normalized: input('value').trim(),
        upper: output('normalized').upperCase(),
      },
      output: { value: output('upper') },
    })` })
    expect(compiled.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    const result = await createExecutor().run(compiled.payload, { value: '  abc  ' }, null)
    expect(result).toEqual({ value: 'ABC' })
  })

  it('freezes operation input and reuses it for undo and default redo', async () => {
    const compiled = compileActionSource({ source: `defineAction({
      steps: {
        edit: operation({
          input: { id: input('id'), value: input('value'), previousValue: input('previousValue') },
          run: { steps: {}, output: input('value') },
          undo: { steps: {}, output: input('previousValue') },
        }),
      },
      output: output('edit'),
    })` })
    const history = new OperationHistory({ id: 'test' })
    const external = { id: '42', value: 'NEW', previousValue: 'OLD' }
    const result = await createExecutor({ resolveOperationHistory: () => history }).run(compiled.payload, external, {} as any)
    external.value = 'MUTATED'
    external.previousValue = 'MUTATED'
    expect(result).toBe('NEW')
    expect(await history.undo()).toBe('OLD')
    expect(await history.redo()).toBe('NEW')
  })

  it('uses the parent Action input when operation input is omitted', async () => {
    const compiled = compileActionSource({ source: `defineAction({
      steps: {
        edit: operation({
          run: { steps: {}, output: input('value') },
          undo: { steps: {}, output: input('previousValue') },
        }),
      },
      output: output('edit'),
    })` })
    const history = new OperationHistory({ id: 'test' })
    const external = { value: 'NEW', previousValue: 'OLD' }
    await expect(createExecutor({ resolveOperationHistory: () => history }).run(compiled.payload, external, {} as any)).resolves.toBe('NEW')
    external.previousValue = 'MUTATED'
    await expect(history.undo()).resolves.toBe('OLD')
    await expect(history.redo()).resolves.toBe('NEW')
  })

  it('does not commit an operation when run fails', async () => {
    const compiled = compileActionSource({ source: `defineAction({ steps: {
      edit: operation({
        input: {},
        run: { steps: { missing: query({ identity: 'missing-query', input: {} }) } },
        undo: { steps: {} },
      }),
    } })` })
    const history = new OperationHistory({ id: 'test' })
    await expect(createExecutor({ resolveOperationHistory: () => history }).run(compiled.payload, {}, {} as any)).rejects.toThrow('Action Query is missing')
    expect(history.snapshot()).toMatchObject({ size: 0, cursor: 0 })
  })

  it('passes runOutput and undoOutput to custom redo', async () => {
    const compiled = compileActionSource({ source: `defineAction({ steps: {
      edit: operation({
        input: { value: input('value'), previousValue: input('previousValue') },
        run: { steps: {}, output: input('value') },
        undo: { steps: {}, output: input('previousValue') },
        redo: { steps: {}, output: { run: runOutput(), undo: undoOutput() } },
      }),
    }, output: output('edit') })` })
    const history = new OperationHistory({ id: 'test' })
    await createExecutor({ resolveOperationHistory: () => history }).run(compiled.payload, { value: 'NEW', previousValue: 'OLD' }, {} as any)
    await history.undo()
    await expect(history.redo()).resolves.toEqual({ run: 'NEW', undo: 'OLD' })
  })

  it('получает Query capability явно от владельца Executor', async () => {
    const compiled = compileActionSource({ source: `defineAction({
      steps: { result: query({ identity: 'test-query', input: { value: input('value') } }) },
      output: output('result'),
    })` })
    const query = { identity: 'test-query' } as RQuery
    const resolveQuery = vi.fn(() => query)
    const runQuery = vi.fn(async () => ({ rows: [1] }))

    await expect(createExecutor({ resolveQuery, runQuery }).run(compiled.payload, { value: 42 }, null)).resolves.toEqual({ rows: [1] })
    expect(resolveQuery).toHaveBeenCalledWith('test-query')
    expect(runQuery).toHaveBeenCalledWith(query, { value: 42 }, null)
  })
})
