import type { DataViewProgramPayload } from '@/features/core/modules/program/domain/types/program.types'

import { describe, expect, it } from 'vitest'

import { compileDataViewSource } from '@/features/core/modules/source/services/compilers/data-view-source-compile'

describe('компилятор pipeline select для DataView', () => {
  it('компилирует последовательные шаги select как pipeline полной материализации', () => {
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

  it('отклоняет смешение шагов select со структурными шагами коллекции', () => {
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

  it('требует ровно одно выражение в select', () => {
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
