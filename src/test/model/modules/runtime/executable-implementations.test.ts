import { describe, expect, it, vi } from 'vitest'

import { EndgeImplementations } from '@/model/modules/runtime/implementation/endge-implementations'

describe('endgeImplementations', () => {
  it('selects a scoped override and immediately returns to the default after disposal', async () => {
    const implementations = new EndgeImplementations()
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

  it('rejects an incompatible provider contract before execution', () => {
    const implementations = new EndgeImplementations()
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

  it('does not hide an explicitly bound missing provider', () => {
    const implementations = new EndgeImplementations()
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
