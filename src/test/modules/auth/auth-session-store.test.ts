import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthSessionStore } from '@/modules/auth/services/AuthSessionStore'
import { authProfile, MemoryStorage, tokenSet } from '@/test/modules/auth/auth-test-helpers'

describe('хранилище сессии авторизации', () => {
  let localStorage: MemoryStorage
  beforeEach(() => {
    localStorage = new MemoryStorage()
    vi.stubGlobal('localStorage', localStorage)
    vi.stubGlobal('sessionStorage', new MemoryStorage())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('использует хранилище профиля и по умолчанию не сохраняет refresh token', () => {
    const store = new AuthSessionStore()
    const profile = authProfile()
    store.write('workspace', profile, snapshot(profile))
    const raw = localStorage.getItem(store.getKey('workspace', profile.identity)) ?? ''
    expect(raw).toContain('access-token')
    expect(raw).not.toContain('refresh-token')
  })

  it('сохраняет refresh token только после явного согласия', () => {
    const store = new AuthSessionStore()
    const profile = authProfile({ session: { storage: 'localStorage', persistRefreshToken: true } })
    store.write('workspace', profile, snapshot(profile))
    expect(localStorage.getItem(store.getKey('workspace', profile.identity))).toContain('refresh-token')
  })
})

function snapshot(profile: ReturnType<typeof authProfile>) {
  return { version: 1 as const, profileIdentity: profile.identity, adapterId: profile.adapterId, token: tokenSet(), updatedAt: '2026-08-18T00:00:00.000Z' }
}
