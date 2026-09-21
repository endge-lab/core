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

  it('публикует stateful execution registries как корневые Modules', () => {
    for (const key of ['implementations', 'actions', 'computations', 'converters']) {
      expect(Endge.hasModule(key)).toBe(true)
    }

    for (const key of ['query', 'dataView', 'composition']) {
      expect(Endge.hasModule(key)).toBe(false)
    }

    expect(Endge.runtime.query).toBeDefined()
    expect(Endge.runtime.dataView).toBeDefined()
    expect(Endge.runtime.composition).toBeDefined()
  })

  it('не дублирует effective variables на уровне федерации', () => {
    expect(Endge.hasModule('vars')).toBe(false)
    expect(Endge.workspace.variables).toBeDefined()
  })
})
