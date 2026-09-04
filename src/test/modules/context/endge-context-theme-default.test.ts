import { beforeEach, describe, expect, it } from 'vitest'

import { CONTEXT_STORAGE_KEY, LEGACY_THEME_STORAGE_KEY } from '@/kernel/config/kernel.config'
import { EndgeContext_Module } from '@/modules/context/EndgeContext_Module'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

const configuration = TEST_ENDGE_WORKSPACE.configuration

describe('эффективная тема по умолчанию EndgeContext', () => {
  beforeEach(() => {
    installLocalStorageMock()
  })

  it('использует эффективное значение по умолчанию после запуска при отсутствии настройки', async () => {
    const context = new EndgeContext_Module()
    await Promise.resolve()

    expect(context.currentTheme).toBe('dark')

    context.reconcileCurrentThemeWithWorkspace(configuration)

    expect(context.currentTheme).toBe('light')
    expect(context.serialize().theme).toBe('light')
    expect(readStoredContext()).toMatchObject({
      theme: null,
      themePreferenceVersion: 1,
    })
  })

  it('предпочитает явную поддерживаемую настройку эффективному значению по умолчанию', async () => {
    localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify({
      theme: 'dark',
      themePreferenceVersion: 1,
    }))

    const context = new EndgeContext_Module()
    await Promise.resolve()
    context.reconcileCurrentThemeWithWorkspace(configuration)

    expect(context.currentTheme).toBe('dark')
  })

  it('не считает стартовую тему без версии пользовательской настройкой', async () => {
    localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify({ theme: 'dark' }))

    const context = new EndgeContext_Module()
    await Promise.resolve()
    context.reconcileCurrentThemeWithWorkspace(configuration)

    expect(context.currentTheme).toBe('light')
    expect(readStoredContext()).toMatchObject({
      theme: null,
      themePreferenceVersion: 1,
    })
  })

  it('сохраняет выбор из отдельного legacy-ключа настройки', async () => {
    localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify({ theme: 'dark' }))
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'dark')

    const context = new EndgeContext_Module()
    await Promise.resolve()
    context.reconcileCurrentThemeWithWorkspace(configuration)

    expect(context.currentTheme).toBe('dark')
    expect(readStoredContext()).toMatchObject({
      theme: 'dark',
      themePreferenceVersion: 1,
    })
  })

  it('сохраняет новую явную настройку вместе с маркером версии', async () => {
    const context = new EndgeContext_Module()
    await Promise.resolve()
    context.reconcileCurrentThemeWithWorkspace(configuration)
    context.setCurrentTheme('dark')

    const restored = new EndgeContext_Module()
    await Promise.resolve()
    restored.reconcileCurrentThemeWithWorkspace(configuration)

    expect(readStoredContext()).toMatchObject({
      theme: 'dark',
      themePreferenceVersion: 1,
    })
    expect(restored.currentTheme).toBe('dark')
  })
})

function readStoredContext(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(CONTEXT_STORAGE_KEY) ?? '{}') as Record<string, unknown>
}

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
