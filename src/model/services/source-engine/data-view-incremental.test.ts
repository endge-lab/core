import { describe, expect, it } from 'vitest'

import { compileDataViewSource } from '@/model/services/source-engine/data-view-source-compile'
import type { DataViewProgramPayload } from '@/domain/types/program.types'

describe('DataView incremental compiler', () => {
  it('defaults to auto and proves a root row-local id projection', () => {
    const result = compileDataViewSource(rowLocalSource(''))
    expect(result.diagnostics).toEqual([])
    expect(result.document?.incremental).toEqual({ mode: 'auto' })
    expect((result.artifact as DataViewProgramPayload).materializationStrategy).toEqual({ kind: 'collection-by-key', key: 'id' })
  })

  it('supports explicit full and a proven custom key', () => {
    const fullResult = compileDataViewSource(rowLocalSource('incremental: full(),'))
    expect((fullResult.artifact as DataViewProgramPayload).materializationStrategy).toEqual({ kind: 'full' })

    const byCode = compileDataViewSource(`
defineDataView({
  mode: 'pipeline',
  incremental: collectionByKey('code'),
  steps: [
    from('').as('row'),
    map({ code: path('row.code'), label: path('row.name').convert('string-trim') }),
  ],
})
`)
    expect(byCode.diagnostics).toEqual([])
    expect((byCode.artifact as DataViewProgramPayload).materializationStrategy).toEqual({ kind: 'collection-by-key', key: 'code' })
  })

  it('falls back to full for joins and nested DataViews in auto mode', () => {
    const joined = compileDataViewSource(`
defineDataView({
  mode: 'pipeline',
  steps: [
    from('').as('row'),
    join('attrs').by({ left: 'row.id', right: 'rowId', as: 'attr' }),
    map({ id: path('row.id') }),
  ],
})
`)
    expect((joined.artifact as DataViewProgramPayload).materializationStrategy).toEqual({ kind: 'full' })

    const nested = compileDataViewSource(`
defineDataView({
  mode: 'pipeline',
  steps: [
    from('').dataView(dataView('normalize')).as('row'),
    map({ id: path('row.id') }),
  ],
})
`)
    expect((nested.artifact as DataViewProgramPayload).materializationStrategy).toEqual({ kind: 'full' })
  })

  it('rejects unproven explicit byKey, manual byKey and invalid strategy syntax', () => {
    const unproven = compileDataViewSource(`
defineDataView({
  mode: 'pipeline',
  incremental: collectionByKey('id'),
  steps: [from('items').as('row'), map({ id: path('row.id') })],
})
`)
    expect(unproven.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'data-view-source-incremental-not-row-local', severity: 'error' }),
    ]))

    const manual = compileDataViewSource(`
defineDataView({
  mode: 'manual',
  incremental: collectionByKey('id'),
  transform(input) { return input },
})
`)
    expect(manual.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'data-view-source-incremental-manual', severity: 'error' }),
    ]))

    for (const incremental of [`collectionByKey('')`, 'custom()', `'full'`]) {
      const invalid = compileDataViewSource(rowLocalSource(`incremental: ${incremental},`))
      expect(invalid.diagnostics.some(item => item.severity === 'error')).toBe(true)
    }
  })
})

function rowLocalSource(incremental: string): string {
  return `
defineDataView({
  mode: 'pipeline',
  ${incremental}
  steps: [
    from('').as('row'),
    map({
      id: path('row.id'),
      name: path('row.name'),
      label: template('{row.name}'),
      enabled: true,
    }),
  ],
})
`
}
