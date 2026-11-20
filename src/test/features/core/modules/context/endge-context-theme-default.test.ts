import { beforeEach, describe, expect, it } from 'vitest'

import { CONTEXT_STORAGE_KEY, LEGACY_THEME_STORAGE_KEY } from '@/features/core/kernel/config/kernel.config'
import { EndgeContext_Module } from '@/features/core/modules/context/EndgeContext_Module'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

const configuration = TEST_ENDGE_WORKSPACE.configuration

describe('эффективная тема EndgeContext', () => {
  beforeEach(() => {
    installLocalStorageMock()
  })

  it('игнорирует предыдущие форматы темы и горячих клавиш', () => {
    localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify({ user: 'old-user', theme: 'dark', themePreferenceVersion: 1 }))
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'dark')
    localStorage.setItem('endge:user-state:v1:user:old-user:key:commands.shortcuts', JSON.stringify({ old: true }))

    const context = createContext('aodb')

    expect(context.currentTheme).toBe('light')
    expect(context.getCurrentUserStateId()).toBeNull()
    expect(context.getUserState('old-user', 'commands.shortcuts')).toBeUndefined()
    context.setCurrentUser('old-user')
    expect(context.currentTheme).toBe('light')
  })

  it('разделяет тему и горячие клавиши между приложениями и восстанавливает их после перезапуска', () => {
    const aodb = createContext('aodb-app')
    const slots = createContext('@slot/ui')
    aodb.setCurrentUser('egor', 'https://sso.example/realms/dev')
    slots.setCurrentUser('egor', 'https://sso.example/realms/dev')
    const user = aodb.getCurrentUserStateId()!
    const shortcutKey = 'commands.shortcuts'
    aodb.setCurrentTheme('dark')
    aodb.setUserState(user, shortcutKey, 'KeyA')
    slots.setUserState(user, shortcutKey, 'KeyS')

    expect(aodb.currentTheme).toBe('dark')
    expect(slots.currentTheme).toBe('light')
    expect(aodb.getUserState(user, shortcutKey)).toBe('KeyA')
    expect(slots.getUserState(user, shortcutKey)).toBe('KeyS')
    expect(localStorage.getItem(`endge:user-state:v2:app:%40slot%2Fui:user:${encodeURIComponent(user)}:key:${shortcutKey}`)).toBe('"KeyS"')

    const restored = createContext('aodb-app')
    restored.setCurrentUser('egor', 'https://sso.example/realms/dev')
    expect(restored.currentTheme).toBe('dark')
    expect(restored.getUserState(user, shortcutKey)).toBe('KeyA')
  })

  it('перечитывает тему при смене пользователя и issuer, без переноса гостевого выбора', () => {
    const context = createContext('aodb')
    let identity: { userId: string, identityNamespace: string } | null = null
    context.setSessionIdentityProvider({ getCurrentIdentity: () => identity })
    context.setCurrentTheme('dark')

    identity = { userId: '42', identityNamespace: 'oidc-one' }
    context.notify()
    expect(context.currentTheme).toBe('light')
    context.setCurrentTheme('dark')

    identity = { userId: '42', identityNamespace: 'oidc-two' }
    context.notify()
    expect(context.currentTheme).toBe('light')
    identity = { userId: '43', identityNamespace: 'oidc-one' }
    context.notify()
    expect(context.currentTheme).toBe('light')
    identity = { userId: '42', identityNamespace: 'oidc-one' }
    context.notify()
    expect(context.currentTheme).toBe('dark')
    identity = null
    context.notify()
    expect(context.currentTheme).toBe('light')
  })

  it('восстанавливает настройку по ID сессии, полученному без OIDC', () => {
    const context = createContext('aodb')
    context.setCurrentUser('directory-account-13')
    context.setCurrentTheme('dark')

    const restored = createContext('aodb')
    expect(restored.currentTheme).toBe('light')
    restored.setCurrentUser('directory-account-13')
    expect(restored.currentTheme).toBe('dark')
  })
})

function createContext(appId: string): EndgeContext_Module {
  const context = new EndgeContext_Module()
  context.setup({ appId, scope: {}, vars: {}, ui: { defaultTheme: 'light' } })
  context.reconcileCurrentThemeWithWorkspace(configuration)
  return context
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
