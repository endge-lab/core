import { describe, expect, it } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'

describe('владение модулями Endge', () => {
  it('удаляет выведенные из эксплуатации модули и сохраняет регистрацию Updates', () => {
    expect(Endge.hasModule('extract')).toBe(false)
    expect(Endge.hasModule('store')).toBe(false)
    expect(Endge.hasModule('updates')).toBe(true)
  })

  it('владеет профилями авторизации через EndgeAuth_Module без параллельного модуля', () => {
    expect(Endge.hasModule('authProfiles')).toBe(false)
    expect(Endge.auth.profiles).toBeDefined()
    expect(Endge.auth.session).toBeDefined()
    expect(Endge.auth.requests).toBeDefined()
  })

  it('владеет сервисами выполнения через EndgeRuntime_Module', () => {
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

  it('владеет эффективными переменными через EndgeWorkspace_Module', () => {
    expect(Endge.hasModule('vars')).toBe(false)
    expect(Endge.vars).toBe(Endge.workspace.variables)
  })
})
