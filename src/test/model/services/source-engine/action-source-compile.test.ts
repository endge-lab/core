import { describe, expect, it } from 'vitest'
import { compileActionSource } from '@/model/services/source-engine/compilers/action-source-compile'
import { ACTION_SOURCE_WITH_OPERATION } from '@/test/fixtures/action-source'

describe('Action Source compiler', () => {
  it('builds sequential named steps, explicit output and dependencies', () => {
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

  it('rejects forward references', () => {
    const result = compileActionSource({ source: `defineAction({ steps: { first: output('second'), second: input() } })` })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'action-output-forward-reference', severity: 'error' }))
  })

  it('requires undo for every operation', () => {
    const result = compileActionSource({ source: `defineAction({ steps: { edit: operation({ input: {}, run: { steps: {} } }) } })` })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'action-operation-undo-required', severity: 'error' }))
  })

  it('keeps operation outputs scoped to undo and redo', () => {
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

  it('rejects privileged globals in a TypeScript step', () => {
    const result = compileActionSource({ source: `defineAction({ steps: {
      unsafe: typescript({ inputs: {}, compute() { return Endge.actions } }),
    } })` })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'computation-typescript-global', severity: 'error' }))
  })
})
