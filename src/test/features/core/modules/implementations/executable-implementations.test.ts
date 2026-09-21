import { describe, expect, it, vi } from 'vitest'

import { EndgeImplementations_Module } from '@/features/core/modules/implementations/EndgeImplementations_Module'

describe('реализации Endge', () => {
  it('выбирает переопределение в scope и сразу возвращается к стандартной реализации после освобождения', async () => {
    const implementations = new EndgeImplementations_Module()
    implementations.registerProvider({
      key: 'default',
      origin: { kind: 'local', owner: 'default' },
      execute: () => 'default',
    })
    implementations.registerProvider({
      key: 'customer',
      origin: { kind: 'local', owner: 'customer' },
      execute: () => 'customer',
    })
    const removeOverride = implementations.bind({
      executableType: 'action',
      executableIdentity: 'orders.recalculate',
      providerKey: 'customer',
      scope: 'application',
      priority: 0,
    })
    const request = {
      executable: { type: 'action', identity: 'orders.recalculate' },
      defaultProviderKey: 'default',
    }
    await expect(implementations.execute(request, { executable: request.executable })).resolves.toBe('customer')
    removeOverride()
    await expect(implementations.execute(request, { executable: request.executable })).resolves.toBe('default')
  })

  it('отклоняет несовместимый контракт provider до выполнения', () => {
    const implementations = new EndgeImplementations_Module()
    const execute = vi.fn()
    implementations.registerProvider({
      key: 'provider',
      origin: { kind: 'local', owner: 'test' },
      contract: { input: { type: 'String' } },
      execute,
    })
    expect(() => implementations.resolve({
      executable: { type: 'action', identity: 'typed' },
      defaultProviderKey: 'provider',
      expectedContract: { input: { type: 'Number' } },
    })).toThrow('incompatible')
    expect(execute).not.toHaveBeenCalled()
  })

  it('не скрывает отсутствие явно привязанного provider', () => {
    const implementations = new EndgeImplementations_Module()
    implementations.bind({
      executableType: 'computation',
      executableIdentity: 'total',
      providerKey: 'missing',
      scope: 'application',
    })
    expect(() => implementations.resolveOptional({
      executable: { type: 'computation', identity: 'total' },
      defaultProviderKey: null,
    })).toThrow('not registered')
  })
})
