import type { EndgeWorkspaceStateTransport } from '@/features/core/modules/context/domain/workspace-state.types'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'
import { EndgeContext_Module } from '@/features/core/modules/context/EndgeContext_Module'
import { DisabledContextAdapter } from '@/features/core/modules/context/persistence/adapters/DisabledContextAdapter'
import { LocalStorageContextAdapter } from '@/features/core/modules/context/persistence/adapters/LocalStorageContextAdapter'
import { buildRuntimeStateStorageKey, RuntimeStateController } from '@/features/core/modules/context/persistence/RuntimeStateController'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('сохранение EndgeContext', () => {
  beforeEach(() => {
    installLocalStorageMock()
  })

  it('синхронизирует новые ключи без регистрации, сохраняя область приложения и локальные исключения', async () => {
    const configuration = vi.spyOn(Endge.configuration, 'current', 'get').mockReturnValue({
      ...TEST_ENDGE_WORKSPACE.configuration,
      userStateDriver: 'backend',
    })
    const context = new EndgeContext_Module()
    const save = vi.fn<EndgeWorkspaceStateTransport['save']>(async (_scope, batch) => ({
      resetRevision: batch.resetRevision,
      results: batch.operations.map(op => ({
        key: op.key,
        status: 'saved',
        entry: { key: op.key, value: op.value ?? null, deleted: op.delete === true, revision: 1 },
      })),
    }))
    const backend: EndgeWorkspaceStateTransport = {
      namespace: 'settings-test',
      read: async ({ workspace, application }) => ({
        actorId: 'actor',
        partition: application ?? workspace,
        application,
        resetRevision: 0,
        entries: application
          ? [{ key: 'appearance.locale', value: 'ru', deleted: false, revision: 1 }]
          : [{ key: 'external.removed', value: null, deleted: true, revision: 1 }],
      }),
      save,
    }
    try {
      context.setCurrentWorkspace('workspace-a')
      context.setCurrentUser('user-a')
      context.setup({ appId: 'test-app', scope: {}, vars: {} })
      context.setState('external.legacy', { columns: 2 })
      context.setState('external.removed', 'old')
      await context.start({ scope: {}, vars: {}, workspaceState: { backend, localKeys: ['external.local'] } })

      expect(context.currentLocale).toBe('ru')
      expect(context.getState('external.legacy')).toEqual({ columns: 2 })
      expect(context.getState('external.removed')).toBeUndefined()
      context.setState('external.new', ['column'])
      context.setState('external.local', 'browser-only')
      context.setState('external.large-first', 'a'.repeat(40_000))
      context.setState('external.large-second', 'b'.repeat(40_000))
      context.setCurrentTheme('dark')
      context.setCurrentLocale('en')
      context.setCurrentTimezone('UTC')
      expect(context.getState('external.local')).toBe('browser-only')

      await vi.waitFor(() => {
        const sent = save.mock.calls.flatMap(([scope, batch]) =>
          batch.operations.map(op => [scope.application ?? 'workspace', op.key, op.value]),
        )
        expect(sent).toEqual(expect.arrayContaining([
          ['workspace', 'external.legacy', { columns: 2 }],
          ['workspace', 'external.new', ['column']],
          ['test-app', 'appearance.theme', 'dark'],
          ['test-app', 'appearance.locale', 'en'],
          ['test-app', 'appearance.timezone', 'UTC'],
        ]))
        expect(sent.some(([, key]) => key === 'external.local' || key === 'external.removed')).toBe(false)
        expect(sent.map(([, key]) => key)).toEqual(expect.arrayContaining(['external.large-first', 'external.large-second']))
        for (const [, batch] of save.mock.calls) {
          expect(new TextEncoder().encode(JSON.stringify(batch)).length).toBeLessThanOrEqual(64 * 1024)
        }
      })
    }
    finally {
      context.reset()
      configuration.mockRestore()
    }
  })

  it('сохраняет личные настройки debugger отдельно от remote context и других пользователей', () => {
    const context = new EndgeContext_Module()
    context.setup({ mode: 'debugger', scope: {}, vars: {} })
    const before = context.serialize()
    context.setUserState('developer-a', 'inspection.width', 65)
    context.setUserState('developer-b', 'inspection.width', 35)
    context.setState('inspection.width', 90)
    expect(context.getState('inspection.width')).toBeUndefined()
    expect(context.serialize()).toEqual(before)
    context.deserialize({ workspace: 'remote', user: 'remote-user', facets: {} })
    expect(context.getUserState('developer-a', 'inspection.width')).toBe(65)
    expect(context.getUserState('developer-b', 'inspection.width')).toBe(35)
    expect(context.getUserState('remote-user', 'inspection.width')).toBeUndefined()
    const restored = new EndgeContext_Module()
    expect(restored.getUserState('developer-a', 'inspection.width')).toBe(65)
    expect(() => context.setUserState('', 'inspection.width', 50)).toThrow('User identity is required')
  })

  it('личные настройки соблюдают disabled adapter', () => {
    const context = new EndgeContext_Module()
    context.configurePersistence({ context: 'disabled' })
    context.setUserState('developer', 'inspection.width', 65)
    expect(context.getUserState('developer', 'inspection.width')).toBeUndefined()
    context.configurePersistence({ context: 'local' })
    expect(context.getUserState('developer', 'inspection.width')).toBeUndefined()
  })

  it('оставляет Workspace неразрешённым, пока его не выберет backend', () => {
    const context = new EndgeContext_Module()
    context.deserialize(undefined)

    expect(context.getCurrentWorkspace()).toBeNull()
    expect(context.serialize().workspace).toBeNull()
    expect(() => context.getPersistenceScope()).toThrow('Active workspace has not been loaded')
  })

  it('использует пустую карту фасетов вне выбранных измерений', () => {
    const context = new EndgeContext_Module()

    context.setCurrentWorkspace('workspace-a')
    context.setCurrentUser('')

    expect(context.getPersistenceScope()).toEqual({
      workspaceId: 'workspace-a',
      facetSelections: [],
      userId: 'anonymous',
    })
  })

  it('использует провайдер сессии для пользователя и выбранных фасетов', () => {
    const context = new EndgeContext_Module()
    context.setCurrentWorkspace('workspace-a')
    context.setSessionIdentityProvider({
      getCurrentIdentity: () => ({ userId: 'egor', facetSelections: { region: 'east' } }),
    })
    context.resolveExecutionContext({ facets: [{ identity: 'region', position: 0, documents: ['east', 'west'] }] })

    expect(context.getPersistenceScope()).toEqual({
      workspaceId: 'workspace-a',
      facetSelections: [{ facetIdentity: 'region', documentIdentity: 'east' }],
      userId: 'egor',
    })
  })

  it('сохраняет структурные координаты неизменяемыми до reset', () => {
    const context = new EndgeContext_Module()
    context.setFacetSelection('region', 'east')
    context.setup({
      dataProvider: 'plain',
      scope: {},
      vars: {},
      context: { facets: { region: 'east' } },
    })

    expect(() => context.setFacetSelection('region', 'west')).toThrow('Structural context is immutable')
    expect(context.getFacetSelection('region')).toBe('east')

    context.reset()
    context.setFacetSelection('region', 'west')
    expect(context.getFacetSelection('region')).toBe('west')
  })

  it('сериализует динамические фасеты контекста', () => {
    const context = new EndgeContext_Module()

    context.deserialize({
      facets: { region: 'east' },
      locale: 'en',
    })

    expect(context.serialize()).toEqual({
      workspace: null,
      facets: { region: 'east' },
      user: 'anonymous',
      locale: 'en',
      theme: 'dark',
      timezone: 'local',
    })
  })

  it('разрешает режим данных Workspace с несохраняемым переопределением host', async () => {
    const context = new EndgeContext_Module()
    context.deserialize({ facets: { region: 'east' } })
    await Promise.resolve()

    context.setWorkspaceDataMode('mock')

    expect(context.dataMode).toBe('mock')
    expect(context.isDataModeOverridden).toBe(false)

    context.setDataMode('live')

    expect(context.dataMode).toBe('live')
    expect(context.isMockEnabled).toBe(false)
    expect(context.isDataModeOverridden).toBe(true)
    expect(context.getExecutionContext()).toEqual({
      facets: { region: 'east' },
    })
    expect(JSON.parse(localStorage.getItem('endge:context:v2') ?? '{}')).not.toHaveProperty('dataMode')
    expect(JSON.parse(localStorage.getItem('endge:context:v2') ?? '{}')).not.toHaveProperty('dataModeOverride')

    context.clearDataModeOverride()
    expect(context.dataMode).toBe('mock')
    expect(context.isMockEnabled).toBe(true)
    expect(context.isDataModeOverridden).toBe(false)
  })

  it('строит ключи runtime-хранилища из полного scope и кодирует ID', () => {
    const scope = {
      workspaceId: 'workspace/a',
      facetSelections: [
        { facetIdentity: 'channel', documentIdentity: 'web' },
        { facetIdentity: 'region', documentIdentity: 'east' },
      ],
      userId: 'egor@example.com',
    }

    expect(buildRuntimeStateStorageKey(scope, 'runtime:main')).toBe(
      'endge:runtime-state:v2:workspace:workspace%2Fa:facets:%5B%5B%22channel%22%2C%22web%22%5D%2C%5B%22region%22%2C%22east%22%5D%5D:user:egor%40example.com:runtime:runtime%3Amain',
    )
    expect(buildRuntimeStateStorageKey({ ...scope, userId: 'other' }, 'runtime:main')).not.toBe(
      buildRuntimeStateStorageKey(scope, 'runtime:main'),
    )
  })

  it('хранит секции runtime независимо в локальном хранилище', () => {
    const controller = new RuntimeStateController({
      runtimeId: 'runtime-main',
      scope: {
        workspaceId: 'default',
        facetSelections: [],
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

  it('отделяет ID активного runtime от ID долговременного хранилища', () => {
    const scope = {
      workspaceId: 'workspace',
      facetSelections: [{ facetIdentity: 'region', documentIdentity: 'east' }],
      userId: 'user',
    }
    const first = new RuntimeStateController({
      runtimeId: 'runtime-a',
      storageId: 'schedule-filter',
      scope,
      adapter: new LocalStorageContextAdapter(),
    })
    const second = new RuntimeStateController({
      runtimeId: 'runtime-b',
      storageId: 'schedule-filter',
      scope,
      adapter: new LocalStorageContextAdapter(),
    })

    first.set('filter:schedule', 'state', { airlineCodes: ['SU'] })

    expect(first.runtimeId).not.toBe(second.runtimeId)
    expect(first.storageId).toBe('schedule-filter')
    expect(first.storageKey).toBe(second.storageKey)
    expect(second.get('filter:schedule', 'state', {})).toEqual({ airlineCodes: ['SU'] })
  })

  it('изолирует долговременное состояние при изменении любого измерения контекста', () => {
    const base = {
      workspaceId: 'workspace',
      facetSelections: [{ facetIdentity: 'region', documentIdentity: 'east' }],
      userId: 'user',
    }
    const keys = [
      buildRuntimeStateStorageKey({ ...base, workspaceId: 'other' }, 'schedule-filter'),
      buildRuntimeStateStorageKey({ ...base, facetSelections: [{ facetIdentity: 'region', documentIdentity: 'west' }] }, 'schedule-filter'),
      buildRuntimeStateStorageKey({ ...base, userId: 'other' }, 'schedule-filter'),
    ]
    expect(new Set(keys).size).toBe(3)
    expect(keys).not.toContain(buildRuntimeStateStorageKey(base, 'schedule-filter'))
  })

  it('отключённый адаптер всегда возвращает резервное значение и ничего не записывает', () => {
    const adapter = new DisabledContextAdapter()
    const controller = new RuntimeStateController({
      runtimeId: 'runtime-main',
      scope: {
        workspaceId: 'default',
        facetSelections: [],
        userId: 'anonymous',
      },
      adapter,
    })

    controller.set('table:flights', 'sort', [{ key: 'std', direction: 'asc' }])

    expect(controller.get('table:flights', 'sort', [])).toEqual([])
  })

  it('уведомляет подписчиков при изменении локали', () => {
    const context = new EndgeContext_Module()
    context.deserialize(undefined)
    const listener = vi.fn()

    const off = context.subscribe(listener)
    context.setCurrentLocale('ru')
    off()

    expect(context.currentLocale).toBe('ru')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('сохраняет явный выбор темы отдельно от snapshot контекста', async () => {
    const context = new EndgeContext_Module()
    context.deserialize(undefined)
    await Promise.resolve()

    context.setCurrentUser('operator')
    context.setCurrentTheme('light')

    expect(context.currentTheme).toBe('light')
    expect(context.serialize().theme).toBe('light')
    expect(context.getUserState(context.getCurrentUserStateId()!, 'appearance.theme')).toBe('light')
    expect(JSON.parse(localStorage.getItem('endge:context:v2') ?? '{}').theme).toBeNull()
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
