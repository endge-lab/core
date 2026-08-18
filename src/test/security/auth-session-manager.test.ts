import type { AuthProfileAdapter } from '@/domain/types/auth/auth-profile.types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthAdapterRegistry } from '@/model/modules/security/auth/AuthAdapterRegistry'
import { AuthProfileRegistry } from '@/model/modules/security/auth/AuthProfileRegistry'
import { AuthRequestResolver } from '@/model/modules/security/auth/AuthRequestResolver'
import { AuthSessionManager } from '@/model/modules/security/auth/AuthSessionManager'
import { AuthSessionStore } from '@/model/modules/security/auth/AuthSessionStore'
import { OidcAuthAdapter } from '@/model/modules/security/auth/adapters/OidcAuthAdapter'
import { AuthInteractionRequiredError } from '@/model/modules/security/auth/AuthInteractionRequiredError'
import { authProfile, MemoryStorage, tokenSet } from '@/test/security/auth-test-helpers'

describe('AuthSessionManager', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); vi.stubGlobal('sessionStorage', new MemoryStorage()) })
  afterEach(() => vi.unstubAllGlobals())

  it('uses a host-owned OIDC source and materializes its headers', async () => {
    const runtime = createRuntime()
    runtime.sessions.configureDefault(runtime.profile)
    runtime.sessions.connect(runtime.profile.identity, { resolveToken: async () => tokenSet({ headers: { Authorization: 'Bearer external' } }) })
    await expect(runtime.requests.resolve({ mode: 'inherit' })).resolves.toEqual(expect.objectContaining({ headers: { Authorization: 'Bearer external' } }))
  })

  it('surfaces typed interaction requirement without a source', async () => {
    const onInteractionRequired = vi.fn()
    const runtime = createRuntime(onInteractionRequired)
    runtime.sessions.configureDefault(runtime.profile)
    await expect(runtime.requests.resolve({ mode: 'inherit' })).rejects.toBeInstanceOf(AuthInteractionRequiredError)
    expect(onInteractionRequired).toHaveBeenCalledOnce()
    expect(onInteractionRequired).toHaveBeenCalledWith(expect.objectContaining({
      code: 'auth_interaction_required',
      profileIdentity: runtime.profile.identity,
    }))
  })
})

function createRuntime(onInteractionRequired?: (error: AuthInteractionRequiredError) => void) {
  const profile = authProfile()
  const adapters = new AuthAdapterRegistry()
  adapters.register(new OidcAuthAdapter() as AuthProfileAdapter)
  const profiles = new AuthProfileRegistry(adapters, {
    listProfiles: () => [profile] as any,
    getDefaultIdentity: () => profile.identity,
    resolveValue: value => String(value),
    getSignal: () => undefined,
  })
  const sessions = new AuthSessionManager(profiles, adapters, new AuthSessionStore(), { getWorkspaceIdentity: () => 'workspace', onSessionChange: vi.fn(), now: () => 100_000 })
  return { profile, sessions, requests: new AuthRequestResolver(profiles, sessions, onInteractionRequired) }
}
