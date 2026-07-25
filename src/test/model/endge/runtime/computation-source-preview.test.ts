import { afterEach, describe, expect, it, vi } from 'vitest'

import { Endge } from '@/model/endge/kernel/endge'

describe('Computation transient source preview', () => {
  afterEach(() => {
    Endge.runtime.computation.setSandboxAdapter(null)
  })

  it('executes a declarative draft without publishing an artifact', async () => {
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

    await expect(Endge.runtime.computation.runSource(
      source,
      { value: '  preview  ' },
      'draft-preview',
    )).resolves.toEqual({
      value: 'PREVIEW',
      length: 7,
    })
    expect(Endge.program.getComputationArtifact('draft-preview')).toBeNull()
  })

  it('uses the registered sandbox for an asynchronous TypeScript node', async () => {
    const execute = vi.fn(async request => Number(request.inputs.value) * 2)
    Endge.runtime.computation.setSandboxAdapter({ execute })

    await expect(Endge.runtime.computation.runSource(
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

  it('returns the first compiler diagnostic as a runtime error', async () => {
    await expect(Endge.runtime.computation.runSource(
      'defineComputation({ outputs: {}, result: output(\'missing\') })',
      {},
      'invalid-preview',
    )).rejects.toMatchObject({
      computationIdentity: 'invalid-preview',
      kind: 'compile-errors',
    })
  })
})
