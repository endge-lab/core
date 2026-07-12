import { describe, expect, it } from 'vitest'

import { compileStoreSource } from '@/domain/services/source-engine/store-source-compile'

describe('compileStoreSource', () => {
  it('compiles writable and derived data fields', () => {
    const result = compileStoreSource(`defineStore({
      data: {
        raw: value([]),
        table: derived()
          .from('raw')
          .dataView(defineDataView({
            mode: 'pipeline',
            steps: [
              from('').as('row'),
              map({ ...spread('row') }),
            ],
          })),
      },
    })`)

    expect(result.diagnostics).toEqual([])
    expect(result.artifact).toMatchObject({
      type: 'store',
      sourceVersion: 1,
      data: [
        { key: 'raw', kind: 'value', initial: [] },
        { key: 'table', kind: 'derived', source: 'raw', dataViews: [{ kind: 'inline' }] },
      ],
    })
  })

  it('rejects runtime expressions in value', () => {
    const result = compileStoreSource(`defineStore({ data: { raw: value(createState()) } })`)

    expect(result.artifact).toBeNull()
    expect(result.diagnostics.some(item => item.code === 'store-value-static')).toBe(true)
  })

  it('rejects forward derived references', () => {
    const result = compileStoreSource(`defineStore({
      data: {
        table: derived().from('raw').dataView(dataView('rows')),
        raw: value([]),
      },
    })`)

    expect(result.artifact).toBeNull()
    expect(result.diagnostics.some(item => item.code === 'store-derived-forward-reference')).toBe(true)
  })
})
