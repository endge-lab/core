import type { RQuery } from '@/modules/domain/entities/RQuery'
import type { ActionProgramExecutorDependencies } from '@/modules/runtime/execution/action/action-program-executor'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ActionProgramExecutor } from '@/modules/runtime/execution/action/action-program-executor'
import { OperationHistory } from '@/modules/runtime/operation/operation-history'
import { compileActionSource } from '@/modules/source/services/compilers/action-source-compile'

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

describe('исполнитель программы Action', () => {
  afterEach(() => vi.restoreAllMocks())

  it('последовательно выполняет именованные шаги и публикует только явный output', async () => {
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

  it('фиксирует input операции и повторно использует его для undo и стандартного redo', async () => {
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

  it('использует input родительского Action, если input операции не задан', async () => {
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

  it('не фиксирует операцию при ошибке выполнения', async () => {
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

  it('передаёт runOutput и undoOutput в пользовательский redo', async () => {
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
