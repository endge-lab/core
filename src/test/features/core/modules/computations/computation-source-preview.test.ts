import { afterEach, describe, expect, it, vi } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'

describe('временный preview Source для Computation', () => {
  afterEach(() => {
    Endge.computations.setSandboxAdapter(null)
  })

  it('выполняет декларативный черновик без публикации артефакта', async () => {
    const source = `defineComputation({
      outputs: {
        normalized: input('value').trim().upperCase(),
        state: {
          value: output('normalized'),
          length: output('normalized').size(),
        },
      },
      result: output('state'),
    })`

    await expect(Endge.computations.runSource(
      source,
      { value: '  preview  ' },
      'draft-preview',
    )).resolves.toEqual({
      value: 'PREVIEW',
      length: 7,
    })
    expect(Endge.program.getComputationArtifact('draft-preview')).toBeNull()
  })

  it('использует зарегистрированный sandbox для асинхронного узла TypeScript', async () => {
    const execute = vi.fn(async request => Number(request.inputs.value) * 2)
    Endge.computations.setSandboxAdapter({ execute })

    await expect(Endge.computations.runSource(
      `defineComputation({
        outputs: {
          doubled: typescript({
            inputs: { value: input('value') },
            compute({ value }) { return value * 2 },
          }),
        },
        result: output('doubled'),
      })`,
      { value: 4 },
    )).resolves.toBe(8)
    expect(execute).toHaveBeenCalledOnce()
  })

  it('возвращает первую диагностику компилятора как runtime-ошибку', async () => {
    await expect(Endge.computations.runSource(
      'defineComputation({ outputs: {}, result: output(\'missing\') })',
      {},
      'invalid-preview',
    )).rejects.toMatchObject({
      computationIdentity: 'invalid-preview',
      kind: 'compile-errors',
    })
  })
})
