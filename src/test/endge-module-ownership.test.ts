import { describe, expect, it } from 'vitest'

import { Endge } from '@/model/endge/kernel/endge'

describe('Endge module ownership', () => {
  it('removes retired modules and keeps updates registered', () => {
    expect(Endge.hasModule('extract')).toBe(false)
    expect(Endge.hasModule('store')).toBe(false)
    expect(Endge.hasModule('updates')).toBe(true)
  })

  it('owns auth profiles through EndgeAuth', () => {
    expect(Endge.hasModule('authProfiles')).toBe(false)
    expect(Endge.authProfiles).toBe(Endge.auth.profiles)
  })

  it('owns execution services through EndgeRuntime', () => {
    for (const key of ['query', 'dataView', 'composition', 'flowRegistry', 'flow', 'commands']) {
      expect(Endge.hasModule(key)).toBe(false)
    }

    expect(Endge.query).toBe(Endge.runtime.query)
    expect(Endge.dataView).toBe(Endge.runtime.dataView)
    expect(Endge.composition).toBe(Endge.runtime.composition)
    expect(Endge.flow).toBe(Endge.runtime.flow)
    expect(Endge.flowRegistry).toBe(Endge.runtime.flow.conditions)
    expect(Endge.commands).toBe(Endge.runtime.commands)
  })

  it('owns effective variables through EndgeWorkspace', () => {
    expect(Endge.hasModule('vars')).toBe(false)
    expect(Endge.vars).toBe(Endge.workspace.variables)
  })
})
