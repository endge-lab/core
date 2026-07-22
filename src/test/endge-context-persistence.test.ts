import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setActiveEndgeWorkspace } from '@/model/config/endge-workspace'
import { EndgeContext } from '@/model/endge/context/endge-context'
import { buildRuntimeStateStorageKey, RuntimeStateController } from '@/model/endge/context/persistence/RuntimeStateController'
import { DisabledContextAdapter } from '@/model/endge/context/persistence/adapters/DisabledContextAdapter'
import { LocalStorageContextAdapter } from '@/model/endge/context/persistence/adapters/LocalStorageContextAdapter'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('EndgeContext persistence', () => {
  beforeEach(() => {
    installLocalStorageMock()
    setActiveEndgeWorkspace(TEST_ENDGE_WORKSPACE)
  })

  afterEach(() => {
    setActiveEndgeWorkspace(null)
  })

  it('keeps workspace unresolved until Payload selects it', () => {
    const context = new EndgeContext()
    context.deserialize(undefined)

    expect(context.getCurrentWorkspace()).toBeNull()
    expect(context.serialize().workspace).toBeNull()
    expect(() => context.getPersistenceScope()).toThrow('Active workspace has not been loaded from Payload')
  })

  it('normalizes empty non-workspace scope values to defaults', () => {
    const context = new EndgeContext()

    context.setCurrentWorkspace('workspace-a')
    context.setCurrentTenant('')
    context.setCurrentProject('')
    context.setCurrentEnvironment('')
    context.setCurrentUser('')

    expect(context.getPersistenceScope()).toEqual({
      workspaceId: 'workspace-a',
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

  it('keeps structural coordinates immutable until reset', () => {
    const context = new EndgeContext()
    context.setup({
      dataProvider: 'plain',
      scope: {},
      vars: {},
      context: { tenantIdentity: 'tenant-a', projectIdentity: 'project-a', environmentIdentity: 'dev' },
    })

    expect(() => context.setCurrentProject('project-b')).toThrow('Structural context is immutable')
    expect(context.getCurrentProject()).toBe('project-a')

    context.reset()
    context.setCurrentProject('project-b')
    expect(context.getCurrentProject()).toBe('project-b')
  })

  it('serializes new context fields and reads legacy snapshots', () => {
    const context = new EndgeContext()

    context.deserialize({
      project: 'legacy-project',
      environment: 'prod',
      locale: 'en',
    })

    expect(context.serialize()).toEqual({
      workspace: null,
      tenant: 'default',
      project: 'legacy-project',
      environment: 'prod',
      user: 'anonymous',
      locale: 'en',
      theme: 'light',
    })
  })

  it('resolves Workspace data mode with a non-persisted host override', async () => {
    const context = new EndgeContext()
    context.deserialize({ project: 'project-a', environment: 'prod' })
    await Promise.resolve()

    context.setWorkspaceDataMode('mock')

    expect(context.dataMode).toBe('mock')
    expect(context.isDataModeOverridden).toBe(false)

    context.setDataMode('live')

    expect(context.dataMode).toBe('live')
    expect(context.isMockEnabled).toBe(false)
    expect(context.isDataModeOverridden).toBe(true)
    expect(context.getExecutionContext()).toEqual({
      tenantIdentity: 'default',
      projectIdentity: 'project-a',
      environmentIdentity: 'prod',
    })
    expect(JSON.parse(localStorage.getItem('endge:context:v1') ?? '{}')).not.toHaveProperty('dataMode')
    expect(JSON.parse(localStorage.getItem('endge:context:v1') ?? '{}')).not.toHaveProperty('dataModeOverride')

    context.clearDataModeOverride()
    expect(context.dataMode).toBe('mock')
    expect(context.isMockEnabled).toBe(true)
    expect(context.isDataModeOverridden).toBe(false)
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

  it('separates active runtime id from durable storage id', () => {
    const scope = {
      workspaceId: 'workspace', tenantId: 'tenant', projectId: 'project',
      environmentId: 'prod', userId: 'user',
    }
    const first = new RuntimeStateController({
      runtimeId: 'runtime-a', storageId: 'schedule-filter', scope,
      adapter: new LocalStorageContextAdapter(),
    })
    const second = new RuntimeStateController({
      runtimeId: 'runtime-b', storageId: 'schedule-filter', scope,
      adapter: new LocalStorageContextAdapter(),
    })

    first.set('filter:schedule', 'state', { airlineCodes: ['SU'] })

    expect(first.runtimeId).not.toBe(second.runtimeId)
    expect(first.storageId).toBe('schedule-filter')
    expect(first.storageKey).toBe(second.storageKey)
    expect(second.get('filter:schedule', 'state', {})).toEqual({ airlineCodes: ['SU'] })
  })

  it('isolates durable state when any context dimension changes', () => {
    const base = {
      workspaceId: 'workspace', tenantId: 'tenant', projectId: 'project',
      environmentId: 'prod', userId: 'user',
    }
    const keys = (Object.keys(base) as Array<keyof typeof base>).map(key =>
      buildRuntimeStateStorageKey({ ...base, [key]: `${base[key]}-other` }, 'schedule-filter'),
    )
    expect(new Set(keys).size).toBe(Object.keys(base).length)
    expect(keys).not.toContain(buildRuntimeStateStorageKey(base, 'schedule-filter'))
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
    context.setCurrentLocale('ru')
    off()

    expect(context.currentLocale).toBe('ru')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('persists the current user theme inside the context snapshot', async () => {
    const context = new EndgeContext()
    context.deserialize(undefined)
    await Promise.resolve()

    context.setCurrentTheme('light')

    expect(context.currentTheme).toBe('light')
    expect(context.serialize().theme).toBe('light')
    expect(JSON.parse(localStorage.getItem('endge:context:v1') ?? '{}').theme).toBe('light')
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
