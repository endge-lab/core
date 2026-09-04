import { describe, expect, it } from 'vitest'
import { compileActionSource } from '@/features/core/modules/source/services/compilers/action-source-compile'
import { ACTION_SOURCE_WITH_OPERATION } from '@/test/fixtures/action-source'

describe('компилятор Source для Action', () => {
  it('строит последовательные именованные шаги, явный output и зависимости', () => {
    const result = compileActionSource({ source: ACTION_SOURCE_WITH_OPERATION })
    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(result.payload.sourceDocument?.steps.map(step => step.name)).toEqual(['normalized', 'validation', 'edit'])
    expect(result.payload.sourceDocument?.output).toMatchObject({ type: 'object' })
    expect(result.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'converter', identity: 'string-trim' }),
      expect.objectContaining({ entityType: 'computation', identity: 'schedule.validate-carrier' }),
      expect.objectContaining({ entityType: 'query', identity: 'schedule-update' }),
    ]))
  })

  it('отклоняет опережающие ссылки', () => {
    const result = compileActionSource({ source: `defineAction({ steps: { first: output('second'), second: input() } })` })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'action-output-forward-reference', severity: 'error' }))
  })

  it('требует undo для каждой операции', () => {
    const result = compileActionSource({ source: `defineAction({ steps: { edit: operation({ input: {}, run: { steps: {} } }) } })` })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'action-operation-undo-required', severity: 'error' }))
  })

  it('поддерживает неявный input и сокращённую запись одношагового блока operation', () => {
    const result = compileActionSource({ source: `defineAction({ steps: {
      edit: operation({
        run: query({ identity: 'schedule-update', input: { value: input('value') } }),
        undo: query({ identity: 'schedule-update', input: { value: input('previousValue') } }),
      }),
    } })` })
    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    const operation = result.payload.sourceDocument?.steps[0]
    expect(operation).toMatchObject({ kind: 'operation', input: null })
    if (operation?.kind !== 'operation') {
      throw new Error('Operation was not compiled')
    }
    expect(operation.run).toMatchObject({ output: null, steps: [{ name: 'default', kind: 'query' }] })
    expect(operation.undo).toMatchObject({ output: null, steps: [{ name: 'default', kind: 'query' }] })
  })

  it('ограничивает outputs операции областями undo и redo', () => {
    const result = compileActionSource({ source: `defineAction({
      steps: {
        edit: operation({
          input: { value: input('value') },
          run: { steps: {}, output: runOutput() },
          undo: { steps: {}, output: undoOutput() },
          redo: { steps: {}, output: { run: runOutput(), undo: undoOutput() } },
        }),
      },
    })` })
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'action-operation-output-scope', sourcePath: 'steps.edit.run.output' }),
      expect.objectContaining({ code: 'action-operation-output-scope', sourcePath: 'steps.edit.undo.output' }),
    ]))
  })

  it('отклоняет привилегированные глобальные объекты в шаге TypeScript', () => {
    const result = compileActionSource({ source: `defineAction({ steps: {
      unsafe: typescript({ inputs: {}, compute() { return Endge.actions } }),
    } })` })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'computation-typescript-global', severity: 'error' }))
  })
})
