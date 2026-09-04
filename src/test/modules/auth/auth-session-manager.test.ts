import type { AuthProfileAdapter } from '@/modules/auth/domain/types/auth-profile.types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OidcAuthAdapter } from '@/modules/auth/adapters/OidcAuthAdapter'
import { AuthInteractionRequiredError } from '@/modules/auth/domain/AuthInteractionRequiredError'
import { AuthAdapterRegistry } from '@/modules/auth/services/AuthAdapterRegistry'
import { AuthProfileRegistry } from '@/modules/auth/services/AuthProfileRegistry'
import { AuthRequestResolver } from '@/modules/auth/services/AuthRequestResolver'
import { AuthSessionManager } from '@/modules/auth/services/AuthSessionManager'
import { AuthSessionStore } from '@/modules/auth/services/AuthSessionStore'
import {
  authProfile,
  MemoryStorage,
  tokenSet,
} from '@/test/modules/auth/auth-test-helpers'

describe('менеджер сессии авторизации', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    vi.stubGlobal('sessionStorage', new MemoryStorage())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('использует принадлежащий host источник OIDC и материализует его заголовки', async () => {
    const runtime = createRuntime()
    runtime.sessions.configureDefault(runtime.profile)
    runtime.sessions.connect(runtime.profile.identity, {
      resolveToken: async () =>
        tokenSet({ headers: { Authorization: 'Bearer external' } }),
    })
    await expect(
      runtime.requests.resolve({ mode: 'inherit' }),
    ).resolves.toEqual(
      expect.objectContaining({
        headers: { Authorization: 'Bearer external' },
      }),
    )
  })

  it('предоставляет типизированное требование взаимодействия без источника', async () => {
    const onInteractionRequired = vi.fn()
    const runtime = createRuntime(onInteractionRequired)
    runtime.sessions.configureDefault(runtime.profile)
    await expect(
      runtime.requests.resolve({ mode: 'inherit' }),
    ).rejects.toBeInstanceOf(AuthInteractionRequiredError)
    expect(onInteractionRequired).toHaveBeenCalledOnce()
    expect(onInteractionRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'auth_interaction_required',
        profileIdentity: runtime.profile.identity,
      }),
    )
  })
})

function createRuntime(
  onInteractionRequired?: (error: AuthInteractionRequiredError) => void,
) {
  const profile = authProfile()
  const adapters = new AuthAdapterRegistry()
  adapters.register(new OidcAuthAdapter() as AuthProfileAdapter)
  const profiles = new AuthProfileRegistry(adapters, {
    listProfiles: () => [profile] as any,
    getDefaultIdentity: () => profile.identity,
    resolveValue: value => String(value),
    getSignal: () => undefined,
  })
  const sessions = new AuthSessionManager(
    profiles,
    adapters,
    new AuthSessionStore(),
    {
      getWorkspaceIdentity: () => 'workspace',
      onSessionChange: vi.fn(),
      now: () => 100_000,
    },
  )
  return {
    profile,
    sessions,
    requests: new AuthRequestResolver(
      profiles,
      sessions,
      onInteractionRequired,
    ),
  }
}
