import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthSessionStore } from '@/model/modules/security/auth/AuthSessionStore'
import { authProfile, MemoryStorage, tokenSet } from '@/test/security/auth-test-helpers'

describe('AuthSessionStore', () => {
  let localStorage: MemoryStorage
  let sessionStorage: MemoryStorage

  beforeEach(() => {
    localStorage = new MemoryStorage()
    sessionStorage = new MemoryStorage()
    vi.stubGlobal('localStorage', localStorage)
    vi.stubGlobal('sessionStorage', sessionStorage)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('isolates snapshots by workspace, profile and persistence policy', () => {
    const store = new AuthSessionStore()
    const localProfile = authProfile()
    const sessionProfile = authProfile({ identity: 'session', persist: 'sessionStorage' })
    const memoryProfile = authProfile({ identity: 'memory', persist: 'memory' })

    store.write('workspace-a', localProfile, snapshot(localProfile.identity))
    store.write('workspace-a', sessionProfile, snapshot(sessionProfile.identity))
    store.write('workspace-a', memoryProfile, snapshot(memoryProfile.identity))

    expect(store.getKey('workspace-a', 'auth-main')).toBe('endge:auth:v1:workspace-a:auth-main')
    expect(store.read('workspace-a', localProfile)?.token.accessToken).toBe('access-token')
    expect(store.read('workspace-b', localProfile)).toBeNull()
    expect(store.read('workspace-a', sessionProfile)).not.toBeNull()
    expect(store.read('workspace-a', memoryProfile)).not.toBeNull()
    expect(localStorage.length).toBe(1)
    expect(sessionStorage.length).toBe(1)
  })

  it('deletes corrupted, mismatched and version-mismatched snapshots', () => {
    const store = new AuthSessionStore()
    const profile = authProfile()
    const key = store.getKey('workspace', profile.identity)

    for (const invalid of [
      '{broken',
      JSON.stringify({ ...snapshot(profile.identity), version: 2 }),
      JSON.stringify({ ...snapshot('another-profile') }),
      JSON.stringify({ ...snapshot(profile.identity), adapterId: 'bearer' }),
    ]) {
      localStorage.setItem(key, invalid)
      expect(store.read('workspace', profile)).toBeNull()
      expect(localStorage.getItem(key)).toBeNull()
    }
  })

  it('persists only the versioned token snapshot and reset clears memory only', () => {
    const store = new AuthSessionStore()
    const localProfile = authProfile()
    const memoryProfile = authProfile({ identity: 'memory', persist: 'memory' })
    store.write('workspace', localProfile, snapshot(localProfile.identity))
    store.write('workspace', memoryProfile, snapshot(memoryProfile.identity))

    const raw = localStorage.getItem(store.getKey('workspace', localProfile.identity)) ?? ''
    expect(raw).not.toContain('username')
    expect(raw).not.toContain('password')
    expect(raw).not.toContain('credentialRefs')

    store.resetRuntime()
    expect(store.read('workspace', memoryProfile)).toBeNull()
    expect(store.read('workspace', localProfile)).not.toBeNull()
  })
})

function snapshot(profileIdentity: string) {
  return {
    version: 1 as const,
    profileIdentity,
    adapterId: 'keycloak' as const,
    token: tokenSet(),
    updatedAt: '2026-08-10T00:00:00.000Z',
  }
}
