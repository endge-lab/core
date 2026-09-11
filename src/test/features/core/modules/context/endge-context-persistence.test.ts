import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EndgeContext_Module } from '@/features/core/modules/context/EndgeContext_Module'
import { DisabledContextAdapter } from '@/features/core/modules/context/persistence/adapters/DisabledContextAdapter'
import { LocalStorageContextAdapter } from '@/features/core/modules/context/persistence/adapters/LocalStorageContextAdapter'
import { buildRuntimeStateStorageKey, RuntimeStateController } from '@/features/core/modules/context/persistence/RuntimeStateController'

describe('сохранение EndgeContext', () => {
  beforeEach(() => {
    installLocalStorageMock()
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

  it('сохраняет текущую пользовательскую тему внутри snapshot контекста', async () => {
    const context = new EndgeContext_Module()
    context.deserialize(undefined)
    await Promise.resolve()

    context.setCurrentTheme('light')

    expect(context.currentTheme).toBe('light')
    expect(context.serialize().theme).toBe('light')
    expect(JSON.parse(localStorage.getItem('endge:context:v2') ?? '{}').theme).toBe('light')
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
