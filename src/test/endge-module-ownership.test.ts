import { describe, expect, it } from 'vitest'

import { Endge } from '@/model/kernel/endge'

describe('Endge module ownership', () => {
  it('removes retired modules and keeps updates registered', () => {
    expect(Endge.hasModule('extract')).toBe(false)
    expect(Endge.hasModule('store')).toBe(false)
    expect(Endge.hasModule('updates')).toBe(true)
  })

  it('owns auth profiles through EndgeAuth without a parallel module', () => {
    expect(Endge.hasModule('authProfiles')).toBe(false)
    expect(Endge.auth.profiles).toBeDefined()
    expect(Endge.auth.session).toBeDefined()
    expect(Endge.auth.requests).toBeDefined()
  })

  it('owns execution services through EndgeRuntime', () => {
    for (const key of ['query', 'dataView', 'composition', 'actions', 'computations', 'converters']) {
      expect(Endge.hasModule(key)).toBe(false)
    }

    expect(Endge.query).toBe(Endge.runtime.query)
    expect(Endge.dataView).toBe(Endge.runtime.dataView)
    expect(Endge.composition).toBe(Endge.runtime.composition)
    expect(Endge.actions).toBe(Endge.runtime.actions)
    expect(Endge.computations).toBe(Endge.runtime.computation)
    expect(Endge.converters).toBe(Endge.runtime.converters)
  })

  it('owns effective variables through EndgeWorkspace', () => {
    expect(Endge.hasModule('vars')).toBe(false)
    expect(Endge.vars).toBe(Endge.workspace.variables)
  })
})
