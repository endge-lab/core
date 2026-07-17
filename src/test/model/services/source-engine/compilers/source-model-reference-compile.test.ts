import { describe, expect, it } from 'vitest'

import type { DataViewRef } from '@/domain/types/source/data-view-source.types'

import { compileDataViewSource } from '@/model/services/source-engine/compilers/data-view-source-compile'
import { compileQuerySource } from '@/model/services/source-engine/compilers/query-source-compile'
import { compileStoreSource } from '@/model/services/source-engine/compilers/store-source-compile'

const DATA_VIEW_REFERENCES = [
  { source: `'normalize'`, expected: { kind: 'external', identity: 'normalize' } },
  { source: `dataView('normalize')`, expected: { kind: 'external', identity: 'normalize' } },
  {
    source: `defineDataView({
      mode: 'pipeline',
      steps: [from('').as('row'), map({ ...spread('row') })],
    })`,
    expected: { kind: 'inline' },
  },
] as const

describe('typed source model references', () => {
  it.each(DATA_VIEW_REFERENCES)('accepts $source in Store DataView slots', ({ source, expected }) => {
    const result = compileStoreSource(`defineStore({
      data: {
        raw: value([]),
        rows: derived().from('raw').dataView(${source}),
      },
    })`)

    expect(result.diagnostics).toEqual([])
    expect((result.document?.data[1] as { dataViews: DataViewRef[] }).dataViews[0]).toMatchObject(expected)
  })

  it.each(DATA_VIEW_REFERENCES)('accepts $source in Query DataView slots', ({ source, expected }) => {
    const result = compileQuerySource(`defineQuery({
      request: { endpoint: '/api' },
      outputs: {
        rows: output().from(response('items')).dataView(${source}),
      },
    })`)

    expect(result.diagnostics).toEqual([])
    expect(result.document?.outputs[0]?.dataViews[0]).toMatchObject(expected)
  })

  it.each(DATA_VIEW_REFERENCES)('accepts $source in nested DataView slots', ({ source, expected }) => {
    const result = compileDataViewSource(`defineDataView({
      mode: 'pipeline',
      steps: [
        from('items').dataView(${source}).as('row'),
        map({ ...spread('row') }),
      ],
    })`)

    expect(result.diagnostics).toEqual([])
    const from = result.document?.steps?.find(step => step.type === 'from')
    expect(from?.dataViews?.[0]).toMatchObject(expected)
  })

  it.each([
    `'date.iso_to_time'`,
    `converter('date.iso_to_time')`,
  ])('accepts converter identity form %s', (reference) => {
    const result = compileDataViewSource(`defineDataView({
      mode: 'pipeline',
      steps: [
        from('').as('row'),
        map({ value: path('row.value').convert(${reference}) }),
      ],
    })`)

    expect(result.diagnostics).toEqual([])
    const map = result.document?.steps?.find(step => step.type === 'map') as any
    expect(map.fields.value.operations[0]).toMatchObject({
      type: 'convert',
      converter: 'date.iso_to_time',
    })
  })
})
