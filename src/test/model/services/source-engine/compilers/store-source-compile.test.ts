import { describe, expect, it } from 'vitest'

import { compileStoreSource } from '@/model/services/source-engine/compilers/store-source-compile'

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
        { key: 'raw', kind: 'value', initial: { kind: 'literal', value: [] } },
        { key: 'table', kind: 'derived', source: 'raw', dataViews: [{ kind: 'inline' }] },
      ],
    })
  })

  it('compiles mock reference as a writable value initializer', () => {
    const result = compileStoreSource(`defineStore({
      data: {
        raw: value(mock('groundhandling')),
      },
    })`)

    expect(result.diagnostics).toEqual([])
    expect(result.artifact?.data).toEqual([
      {
        key: 'raw',
        kind: 'value',
        initial: { kind: 'mock', identity: 'groundhandling' },
      },
    ])
  })

  it('rejects invalid mock references', () => {
    for (const expression of ['mock()', "mock('')", 'mock(identity)', "mock('one', 'two')"]) {
      const result = compileStoreSource(`defineStore({ data: { raw: value(${expression}) } })`)

      expect(result.artifact).toBeNull()
      expect(result.diagnostics.some(item => item.code === 'store-value-static')).toBe(true)
    }
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
