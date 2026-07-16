import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ComputationProgramPayload } from '@/domain/types/computation'
import type { ProgramArtifact } from '@/domain/types/program/program.types'
import { Endge } from '@/model/endge/kernel/endge'
import { ComputationResourceState } from '@/model/endge/runtime/execution/computation/ComputationResource'
import { compileComputation } from '@/model/services/compiler/computation/computation-compile'

describe('ComputationResourceState', () => {
  afterEach(() => Endge.program.clear())

  it('creates an immediate success resource for sync execution', () => {
    const resource = new ComputationResourceState(5, async value => value, value => Number(value) * 2)
    expect(resource.status).toBe('success')
    expect(resource.loading).toBe(false)
    expect(resource.value).toBe(10)
  })

  it('keeps only the latest asynchronous result and disposes subscriptions', async () => {
    const resolvers: Array<(value: number) => void> = []
    const listener = vi.fn()
    const resource = new ComputationResourceState<number>(1, () => new Promise(resolve => resolvers.push(resolve)))
    const unsubscribe = resource.subscribe(listener)
    resource.updateInput(2)
    resolvers[0]!(10)
    await Promise.resolve()
    expect(resource.value).toBeUndefined()
    resolvers[1]!(20)
    await Promise.resolve()
    expect(resource.value).toBe(20)
    expect(resource.status).toBe('success')
    unsubscribe()
    resource.dispose()
  })

  it('detects nested input changes independently of object key order', () => {
    const run = vi.fn((input: any) => input.process.point.value)
    const resource = new ComputationResourceState(
      { process: { point: { value: 1, code: 'value' } } },
      async input => run(input),
      input => run(input),
    )
    resource.updateInput({ process: { point: { code: 'value', value: 1 } } })
    expect(run).toHaveBeenCalledTimes(1)
    resource.updateInput({ process: { point: { code: 'value', value: 2 } } })
    expect(run).toHaveBeenCalledTimes(2)
    expect(resource.value).toBe(2)
  })

  it('uses a local identity override as a full replacement without fallback', () => {
    const compiled = compileComputation({
      source: 'defineComputation({ outputs: { value: 1 }, result: output(\'value\') })',
      input: null,
      output: null,
    })
    Endge.program.beginCompile('test')
    Endge.program.addArtifact({
      ref: { entityType: 'computation', id: 17, identity: 'override-demo' },
      sourceHash: 'test',
      compilerVersion: 'test',
      status: 'valid',
      diagnostics: [],
      dependencies: [],
      capabilities: ['compilable', 'runnable'],
      metadata: { self: {}, nodes: [] },
      payload: compiled.payload,
    } satisfies ProgramArtifact<ComputationProgramPayload>)

    const unbind = Endge.bind.computation('override-demo', {
      execution: 'sync',
      run: () => 5,
    })
    expect(Endge.runtime.computation.runSync(17, {})).toBe(5)
    unbind()
    expect(Endge.runtime.computation.runSync(17, {})).toBe(1)

    const removeThrowing = Endge.bind.computation('override-demo', {
      execution: 'sync',
      run: () => { throw new Error('override failed') },
    })
    expect(() => Endge.runtime.computation.runSync('override-demo', {})).toThrow('override failed')
    expect(Endge.runtime.computation.createResource('override-demo', {}, 'test').error).toEqual(expect.objectContaining({
      computationIdentity: 'override-demo',
      kind: 'override-execution',
    }))
    removeThrowing()
  })
})
