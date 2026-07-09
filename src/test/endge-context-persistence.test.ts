import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EndgeContext } from '@/model/endge/endge-context'
import { buildRuntimeStateStorageKey, RuntimeStateController } from '@/model/endge/context/RuntimeStateController'
import { DisabledContextAdapter } from '@/model/endge/context/adapters/DisabledContextAdapter'
import { LocalStorageContextAdapter } from '@/model/endge/context/adapters/LocalStorageContextAdapter'

describe('EndgeContext persistence', () => {
  beforeEach(() => {
    installLocalStorageMock()
  })

  it('builds default persistence scope', () => {
    const context = new EndgeContext()
    context.deserialize(undefined)

    expect(context.getPersistenceScope()).toEqual({
      workspaceId: 'default',
      tenantId: 'default',
      projectId: 'default',
      environmentId: 'dev',
      userId: 'anonymous',
    })
  })

  it('normalizes empty scope values to defaults', () => {
    const context = new EndgeContext()

    context.setCurrentWorkspace('')
    context.setCurrentTenant('')
    context.setCurrentProject('')
    context.setCurrentEnvironment('')
    context.setCurrentUser('')

    expect(context.getPersistenceScope()).toEqual({
      workspaceId: 'default',
      tenantId: 'default',
      projectId: 'default',
      environmentId: 'dev',
      userId: 'anonymous',
    })
  })

  it('uses session provider for user and tenant scope', () => {
    const context = new EndgeContext()
    context.setCurrentWorkspace('workspace-a')
    context.setCurrentProject('project-a')
    context.setCurrentEnvironment('prod')
    context.setSessionIdentityProvider({
      getCurrentIdentity: () => ({ userId: 'egor', tenantId: 'tenant-a' }),
    })

    expect(context.getPersistenceScope()).toEqual({
      workspaceId: 'workspace-a',
      tenantId: 'tenant-a',
      projectId: 'project-a',
      environmentId: 'prod',
      userId: 'egor',
    })
  })

  it('serializes new context fields and reads legacy snapshots', () => {
    const context = new EndgeContext()

    context.deserialize({
      project: 'legacy-project',
      environment: 'prod',
      locale: 'en',
    })

    expect(context.serialize()).toEqual({
      workspace: 'default',
      tenant: 'default',
      project: 'legacy-project',
      environment: 'prod',
      user: 'anonymous',
      locale: 'en',
    })
  })

  it('builds runtime storage keys from full scope and encodes ids', () => {
    const scope = {
      workspaceId: 'workspace/a',
      tenantId: 'tenant a',
      projectId: 'project:a',
      environmentId: 'dev',
      userId: 'egor@example.com',
    }

    expect(buildRuntimeStateStorageKey(scope, 'runtime:main')).toBe(
      'endge:runtime-state:v1:workspace:workspace%2Fa:tenant:tenant%20a:project:project%3Aa:environment:dev:user:egor%40example.com:runtime:runtime%3Amain',
    )
    expect(buildRuntimeStateStorageKey({ ...scope, userId: 'other' }, 'runtime:main')).not.toBe(
      buildRuntimeStateStorageKey(scope, 'runtime:main'),
    )
  })

  it('stores runtime sections independently in local storage', () => {
    const controller = new RuntimeStateController({
      runtimeId: 'runtime-main',
      scope: {
        workspaceId: 'default',
        tenantId: 'default',
        projectId: 'default',
        environmentId: 'dev',
        userId: 'anonymous',
      },
      adapter: new LocalStorageContextAdapter(),
    })

    controller.set('table:flights', 'sort', [{ key: 'std', direction: 'asc' }])
    controller.set('table:flights', 'pin', [{ key: 'number', side: 'left' }])

    expect(controller.get('table:flights', 'sort', [])).toEqual([{ key: 'std', direction: 'asc' }])
    expect(controller.get('table:flights', 'pin', [])).toEqual([{ key: 'number', side: 'left' }])

    controller.remove('table:flights', 'sort')

    expect(controller.get('table:flights', 'sort', 'fallback')).toBe('fallback')
    expect(controller.get('table:flights', 'pin', [])).toEqual([{ key: 'number', side: 'left' }])
  })

  it('disabled adapter always returns fallback and does not write', () => {
    const adapter = new DisabledContextAdapter()
    const controller = new RuntimeStateController({
      runtimeId: 'runtime-main',
      scope: {
        workspaceId: 'default',
        tenantId: 'default',
        projectId: 'default',
        environmentId: 'dev',
        userId: 'anonymous',
      },
      adapter,
    })

    controller.set('table:flights', 'sort', [{ key: 'std', direction: 'asc' }])

    expect(controller.get('table:flights', 'sort', [])).toEqual([])
  })

  it('notifies subscribers when locale changes', () => {
    const context = new EndgeContext()
    context.deserialize(undefined)
    const listener = vi.fn()

    const off = context.subscribe(listener)
    context.setCurrentLocale('en')
    off()

    expect(context.currentLocale).toBe('en')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

function installLocalStorageMock(): void {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
      clear: () => {
        store.clear()
      },
    },
  })
}
