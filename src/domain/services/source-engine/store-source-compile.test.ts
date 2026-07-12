import { describe, expect, it } from 'vitest'

import { compileStoreSource } from '@/domain/services/source-engine/store-source-compile'

describe('compileStoreSource', () => {
  it('compiles a JSON-compatible initial value', () => {
    const result = compileStoreSource(`defineStore({
      initial: {
        rows: [],
        filters: { active: true },
        limit: 25,
      },
    })`)

    expect(result.diagnostics).toEqual([])
    expect(result.artifact).toEqual({
      type: 'store',
      sourceVersion: 1,
      initial: {
        rows: [],
        filters: { active: true },
        limit: 25,
      },
    })
  })

  it('rejects runtime expressions in initial', () => {
    const result = compileStoreSource(`defineStore({ initial: createState() })`)

    expect(result.artifact).toBeNull()
    expect(result.diagnostics.some(item => item.code === 'store-source-initial-static')).toBe(true)
  })

  it('rejects properties not defined by Store v1', () => {
    const result = compileStoreSource(`defineStore({ initial: {}, mutations: {} })`)

    expect(result.artifact).toBeNull()
    expect(result.diagnostics.some(item => item.code === 'store-source-property-unsupported')).toBe(true)
  })
})
