import { describe, expect, it } from 'vitest'

import { compileComputation } from '@/features/core/modules/compiler/services/computation/computation-compile'
import { ComputationGraphExecutor } from '@/features/core/modules/runtime/execution/computation/ComputationGraphExecutor'

describe('граф compileComputation', () => {
  it('компилирует опережающие ссылки и однократно вычисляет безопасный граф', () => {
    const result = compileComputation({
      source: `defineComputation({
  input: field(ProcessStateInput),
  output: field(ProcessState),
  outputs: {
    state: {
      target: output('targetState'),
    },
    targetState: {
      value: get(input('process.target'), 'value'),
      tone: when(isNil(get(input('process.target'), 'value')), 'muted', 'default'),
    },
  },
  result: output('state'),
})`,
    })

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(result.payload.nodes.map(node => node.name)).toEqual(['targetState', 'state'])
    expect(new ComputationGraphExecutor(() => null).runSync(
      result.payload,
      { process: { target: { value: '07:15' } } },
      'test',
    )).toEqual({ target: { value: '07:15', tone: 'default' } })
  })

  it('компилирует смешанный граф и выполняет узел TypeScript через адаптер', async () => {
    const result = compileComputation({
      source: `defineComputation({
  outputs: {
    base: 5,
    doubled: typescript({
      inputs: { value: output('base') },
      compute({ value }) { return value * 2 },
    }),
    result: { value: output('doubled'), tone: when(gt(output('doubled'), 5), 'success', 'muted') },
  },
  result: output('result'),
})`,
    })
    const executor = new ComputationGraphExecutor(() => ({
      execute: async request => Number(request.inputs.value) * 2,
    }))

    expect(result.payload.execution).toBe('async')
    await expect(executor.run(result.payload, {}, 'mixed')).resolves.toEqual({ value: 10, tone: 'success' })
  })

  it('запускает независимые выходы TypeScript конкурентно', async () => {
    const result = compileComputation({
      source: `defineComputation({
        outputs: {
          a: typescript({ inputs: {}, compute() { return 1 } }),
          b: typescript({ inputs: {}, compute() { return 2 } }),
          total: sum([output('a'), output('b')]),
        },
        result: output('total'),
      })`,
    })
    const started: string[] = []
    const resolvers = new Map<string, (value: number) => void>()
    const executor = new ComputationGraphExecutor(() => ({
      execute: request => new Promise<number>((resolve) => {
        started.push(request.outputName)
        resolvers.set(request.outputName, resolve)
      }),
    }))

    const execution = executor.run(result.payload, {}, 'parallel')
    await Promise.resolve()
    expect(started).toEqual(['a', 'b'])
    resolvers.get('a')!(1)
    resolvers.get('b')!(2)
    await expect(execution).resolves.toBe(3)
  })

  it('выносит внешние computations из цепочек value-выражений в узлы графа', () => {
    const result = compileComputation({
      source: `defineComputation({
        outputs: {
          label: computation('shared.normalize', {
            value: input('name'),
          }).get('label').upperCase(),
        },
        result: output('label'),
      })`,
    })

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(result.payload.nodes).toEqual([
      expect.objectContaining({
        kind: 'computation',
        identity: 'shared.normalize',
        dependencies: [],
      }),
      expect.objectContaining({
        kind: 'expression',
        name: 'label',
        dependencies: [expect.stringMatching(/^__computation_call_/)],
      }),
    ])
    expect(result.payload.execution).toBe('async')
  })

  it('отклоняет динамические identities внешних computations', () => {
    const result = compileComputation({
      source: `defineComputation({
        outputs: { value: computation(input('identity'), input('value')) },
        result: output('value'),
      })`,
    })

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'computation-reference-identity' }),
    ]))
  })

  it('сообщает о неизвестных outputs, циклах, асинхронных блоках и legacy-синтаксисе', () => {
    const invalid = compileComputation({
      source: `defineComputation({
  outputs: {
    a: output('b'),
    b: output('a'),
    c: output('missing'),
    d: typescript({ inputs: {}, async compute() { return 1 } }),
    e: typescript({ inputs: {}, compute() { return computation('hidden', {}) } }),
  },
  result: output('c'),
})`,
    })
    expect(invalid.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'computation-output-unknown', start: expect.any(Number), end: expect.any(Number) }),
      expect.objectContaining({ code: 'computation-output-cycle', start: expect.any(Number), end: expect.any(Number) }),
      expect.objectContaining({ code: 'computation-typescript-async' }),
      expect.objectContaining({ code: 'computation-typescript-reference' }),
    ]))

    expect(compileComputation({
      source: 'export default function compute(input: unknown) { return input }',
    }).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'computation-legacy-source-unsupported' }),
    ]))
  })

  it('отклоняет запрещённые глобальные объекты, не отклоняя локальные имена и ключи объектов', () => {
    const local = compileComputation({
      source: `defineComputation({
        outputs: {
          value: typescript({
            inputs: {},
            compute() {
              const fetch = 5
              return { fetch }
            },
          }),
        },
        result: output('value'),
      })`,
    })
    expect(local.diagnostics.filter(item => item.code === 'computation-typescript-global')).toEqual([])

    const global = compileComputation({
      source: `defineComputation({
        outputs: {
          value: typescript({ inputs: {}, compute() { return fetch('/private') } }),
        },
        result: output('value'),
      })`,
    })
    expect(global.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'computation-typescript-global' }),
    ]))
  })
})
