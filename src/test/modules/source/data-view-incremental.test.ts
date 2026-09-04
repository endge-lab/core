import type { DataViewProgramPayload } from '@/modules/program/domain/types/program.types'

import { describe, expect, it } from 'vitest'
import { EndgeDataView } from '@/modules/runtime/execution/endge-data-view'
import { compileDataViewSource } from '@/modules/source/services/compilers/data-view-source-compile'

describe('инкрементальный компилятор DataView', () => {
  it('по умолчанию выбирает auto и доказывает корневую проекцию локального ID строки', () => {
    const result = compileDataViewSource(rowLocalSource(''))
    expect(result.diagnostics).toEqual([])
    expect(result.document?.incremental).toEqual({ mode: 'auto' })
    expect((result.artifact as DataViewProgramPayload).materializationStrategy).toEqual({ kind: 'collection-by-key', key: 'id' })
  })

  it('поддерживает явный full и доказанный пользовательский ключ', () => {
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

  it('компилирует и выполняет параметризованную локальную фильтрацию строк через filterByKey', () => {
    const result = compileDataViewSource(`
defineDataView({
  mode: 'pipeline',
  props: defineProps({
    search: field('String').default(''),
  }),
  incremental: filterByKey('id'),
  steps: [
    from('').as('row'),
  ],
  filter: ({ row, prop }) =>
    or(
      isEmpty(prop('search')),
      includes(lowerCase(toString(row('flightNumber'))), prop('search')),
      includes(lowerCase(toString(row('airline.code'))), prop('search')),
    ),
})
`)

    expect(result.diagnostics).toEqual([])
    expect((result.artifact as DataViewProgramPayload).materializationStrategy).toEqual({ kind: 'filter-by-key', key: 'id' })
    expect((result.artifact as DataViewProgramPayload).props).toEqual([
      expect.objectContaining({ key: 'search', defaultValue: { type: 'literal', value: '' } }),
    ])

    const rows = [
      { id: 1, flightNumber: 101, airline: { code: 'SU' } },
      { id: 2, flightNumber: 202, airline: { code: 'S7' } },
    ]
    const runtime = new EndgeDataView()
    const payload = result.artifact as DataViewProgramPayload
    expect(runtime.runPayload(payload, rows, undefined, { props: { search: 'su' } })).toEqual([rows[0]])
    expect(runtime.runPayload(payload, rows, undefined, { props: { search: '' } })).toEqual(rows)
  })

  it('переходит к full для joins и вложенных DataView в режиме auto', () => {
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

  it('отклоняет недоказанный явный byKey, ручной byKey и некорректный синтаксис стратегии', () => {
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
