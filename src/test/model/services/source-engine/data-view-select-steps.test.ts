import type { DataViewProgramPayload } from '@/domain/types/program/program.types'

import { describe, expect, it } from 'vitest'

import { compileDataViewSource } from '@/model/services/source-engine/compilers/data-view-source-compile'

describe('DataView select pipeline compiler', () => {
  it('compiles sequential select steps as a full materialization pipeline', () => {
    const result = compileDataViewSource(`
defineDataView({
  mode: 'pipeline',
  steps: [
    select({
      rows: path('items').where(match({ active: true })),
    }),
    select(path('rows').map(pick(['id']))),
  ],
})
`)

    expect(result.diagnostics).toEqual([])
    expect(result.document?.steps?.map(step => step.type)).toEqual(['select', 'select'])
    expect((result.artifact as DataViewProgramPayload).materializationStrategy).toEqual({ kind: 'full' })
  })

  it('rejects mixing select steps with structural collection steps', () => {
    const result = compileDataViewSource(`
defineDataView({
  mode: 'pipeline',
  steps: [
    from('items').as('item'),
    select(path('items')),
  ],
})
`)

    expect(result.artifact).toBeNull()
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'data-view-source-pipeline-step-kind-mixed',
        severity: 'error',
      }),
    ]))
  })

  it('requires exactly one expression in select', () => {
    for (const step of ['select()', `select(path('items'), path('other'))`]) {
      const result = compileDataViewSource(`
defineDataView({
  mode: 'pipeline',
  steps: [${step}],
})
`)

      expect(result.artifact).toBeNull()
      expect(result.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'data-view-source-select-expression-missing',
          severity: 'error',
        }),
      ]))
    }
  })
})
