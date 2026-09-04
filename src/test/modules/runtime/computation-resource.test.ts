import type { ComputationProgramPayload } from '@/modules/domain/types/computation/computation-program.types'

import type { ProgramArtifact } from '@/modules/program/domain/types/program.types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/kernel/endge'
import { compileComputation } from '@/modules/compiler/services/computation/computation-compile'
import { ComputationResourceState } from '@/modules/runtime/execution/computation/ComputationResource'
import { ComputationResourceRegistry } from '@/modules/runtime/execution/computation/ComputationResourceRegistry'

describe('состояние ресурса Computation', () => {
  afterEach(() => Endge.program.clear())

  it('создаёт ресурс с немедленным успешным результатом для синхронного выполнения', () => {
    const resource = new ComputationResourceState(5, async value => value, value => Number(value) * 2)
    expect(resource.status).toBe('success')
    expect(resource.loading).toBe(false)
    expect(resource.value).toBe(10)
  })

  it('сохраняет только последний асинхронный результат и освобождает подписки', async () => {
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

  it('обрабатывает каждую новую ссылку input без сериализации содержимого', () => {
    const run = vi.fn((input: any) => input.process.point.value)
    const resource = new ComputationResourceState(
      { process: { point: { value: 1, code: 'value' } } },
      async input => run(input),
      input => run(input),
    )
    resource.updateInput({ process: { point: { code: 'value', value: 1 } } })
    expect(run).toHaveBeenCalledTimes(2)
    resource.updateInput({ process: { point: { code: 'value', value: 2 } } })
    expect(run).toHaveBeenCalledTimes(3)
    expect(resource.value).toBe(2)
  })

  it('не инвалидирует renderer при синхронном обновлении input, полученном текущим render', () => {
    const onChange = vi.fn()
    const registry = new ComputationResourceRegistry()
    const create = () => new ComputationResourceState(
      { value: 1 },
      async input => input,
      input => input,
    )

    registry.getOrCreate('cell', { value: 1 }, create, onChange)
    const resource = registry.getOrCreate('cell', { value: 2 }, create, onChange)

    expect(resource.value).toEqual({ value: 2 })
    expect(onChange).not.toHaveBeenCalled()
    registry.dispose()
  })

  it('инвалидирует renderer, когда асинхронный ресурс завершается после render', async () => {
    let resolve = (_value: number): void => undefined
    const onChange = vi.fn()
    const registry = new ComputationResourceRegistry()

    registry.getOrCreate('cell', 1, () => new ComputationResourceState<number>(
      1,
      () => new Promise<number>((done) => { resolve = done }),
    ), onChange)
    resolve(2)
    await Promise.resolve()

    expect(onChange).toHaveBeenCalledOnce()
    registry.dispose()
  })

  it('использует локальное переопределение identity как полную замену без fallback', () => {
    const compiled = compileComputation({
      source: 'defineComputation({ outputs: { value: 1 }, result: output(\'value\') })',
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

    const removeProvider = Endge.computations.provide({
      identity: 'override-demo',
      key: 'test.override-demo',
      implementation: { execution: 'sync', run: () => 5 },
    })
    const unbind = Endge.computations.override({ identity: 'override-demo', providerKey: 'test.override-demo' })
    expect(Endge.runtime.computation.runSync(17, {})).toBe(5)
    unbind()
    removeProvider()
    expect(Endge.runtime.computation.runSync(17, {})).toBe(1)

    const removeThrowingProvider = Endge.computations.provide({
      identity: 'override-demo',
      key: 'test.override-demo.throwing',
      implementation: { execution: 'sync', run: () => { throw new Error('override failed') } },
    })
    const removeThrowing = Endge.computations.override({ identity: 'override-demo', providerKey: 'test.override-demo.throwing' })
    expect(() => Endge.runtime.computation.runSync('override-demo', {})).toThrow('override failed')
    expect(Endge.runtime.computation.createResource('override-demo', {}, 'test').error).toEqual(expect.objectContaining({
      computationIdentity: 'override-demo',
      kind: 'override-execution',
    }))
    removeThrowing()
    removeThrowingProvider()
  })
})
