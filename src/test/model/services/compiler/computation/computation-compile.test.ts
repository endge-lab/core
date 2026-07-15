import { describe, expect, it } from 'vitest'

import { compileComputation } from '@/model/services/compiler/computation/computation-compile'
import { evaluateSourceExpression } from '@/model/services/source-engine/source-expression-evaluate'

describe('compileComputation', () => {
  it('compiles input reads and lazy when into safe expression IR', () => {
    const result = compileComputation({
      implementationKind: 'source',
      sourceLanguage: 'typescript',
      input: { type: 'ProcessStateInput' },
      output: { type: 'ProcessState' },
      source: `export default function compute(input: ProcessStateInput): ProcessState {
  return {
    target: {
      value: get(input, 'process.target.value'),
      tone: when(
        isNil(get(input, 'process.target.value')),
        'muted',
        'default',
      ),
    },
  }
}`,
    })

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(result.payload.expression).not.toBeNull()
    expect(evaluateSourceExpression(result.payload.expression!, {
      scope: { process: { target: { value: '07:15' } } },
    })).toEqual({
      target: { value: '07:15', tone: 'default' },
    })
    expect(evaluateSourceExpression(result.payload.expression!, {
      scope: { process: { target: {} } },
    })).toEqual({
      target: { value: undefined, tone: 'muted' },
    })
  })

  it('rejects provider implementations and side-effectful function bodies', () => {
    expect(compileComputation({
      implementationKind: 'provider',
      sourceLanguage: 'typescript',
      source: '',
      input: null,
      output: null,
    }).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'computation-provider-unsupported' }),
    ]))

    expect(compileComputation({
      implementationKind: 'source',
      sourceLanguage: 'typescript',
      source: `export default function compute(input: unknown) {
  console.log(input)
  return input
}`,
      input: { type: 'unknown' },
      output: { type: 'unknown' },
    }).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'computation-single-return-required' }),
    ]))
  })
})
