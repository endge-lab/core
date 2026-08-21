import { beforeEach, describe, expect, it } from 'vitest'

import { CONTEXT_STORAGE_KEY, LEGACY_THEME_STORAGE_KEY } from '@/model/config/kernel.config'
import { EndgeContext } from '@/model/modules/context/endge-context'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

const configuration = TEST_ENDGE_WORKSPACE.configuration

describe('EndgeContext effective default theme', () => {
  beforeEach(() => {
    installLocalStorageMock()
  })

  it('uses the effective default after bootstrap when no preference exists', async () => {
    const context = new EndgeContext()
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

  it('keeps an explicit supported preference over the effective default', async () => {
    localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify({
      theme: 'dark',
      themePreferenceVersion: 1,
    }))

    const context = new EndgeContext()
    await Promise.resolve()
    context.reconcileCurrentThemeWithWorkspace(configuration)

    expect(context.currentTheme).toBe('dark')
  })

  it('does not treat an unversioned bootstrap theme as a user preference', async () => {
    localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify({ theme: 'dark' }))

    const context = new EndgeContext()
    await Promise.resolve()
    context.reconcileCurrentThemeWithWorkspace(configuration)

    expect(context.currentTheme).toBe('light')
    expect(readStoredContext()).toMatchObject({
      theme: null,
      themePreferenceVersion: 1,
    })
  })

  it('preserves a selection from the dedicated legacy preference key', async () => {
    localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify({ theme: 'dark' }))
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'dark')

    const context = new EndgeContext()
    await Promise.resolve()
    context.reconcileCurrentThemeWithWorkspace(configuration)

    expect(context.currentTheme).toBe('dark')
    expect(readStoredContext()).toMatchObject({
      theme: 'dark',
      themePreferenceVersion: 1,
    })
  })

  it('persists a new explicit preference with its version marker', async () => {
    const context = new EndgeContext()
    await Promise.resolve()
    context.reconcileCurrentThemeWithWorkspace(configuration)
    context.setCurrentTheme('dark')

    const restored = new EndgeContext()
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
