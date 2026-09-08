import type { AuthProfileAdapter } from '@/features/core/modules/auth/domain/types/auth-profile.types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OidcAuthAdapter } from '@/features/core/modules/auth/adapters/OidcAuthAdapter'
import { AuthInteractionRequiredError } from '@/features/core/modules/auth/domain/AuthInteractionRequiredError'
import { AuthAdapterRegistry } from '@/features/core/modules/auth/services/AuthAdapterRegistry'
import { AuthProfileRegistry } from '@/features/core/modules/auth/services/AuthProfileRegistry'
import { AuthRequestResolver } from '@/features/core/modules/auth/services/AuthRequestResolver'
import { AuthSessionManager } from '@/features/core/modules/auth/services/AuthSessionManager'
import { AuthSessionStore } from '@/features/core/modules/auth/services/AuthSessionStore'
import {
  authProfile,
  MemoryStorage,
  tokenSet,
} from '@/test/features/core/modules/auth/auth-test-helpers'

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

  /** Ответ прежнего source не восстанавливает уже завершённую сессию. */
  it('отбрасывает поздний токен после logout и разрешает новую сессию', async () => {
    const runtime = createRuntime()
    runtime.sessions.configureDefault(runtime.profile)
    let release!: (value: ReturnType<typeof tokenSet>) => void
    runtime.sessions.connect(runtime.profile.identity, {
      resolveToken: () => new Promise((resolve) => { release = resolve }),
    })
    const pending = runtime.sessions.ensureValid()
    await Promise.resolve()
    await runtime.sessions.logout()
    release(tokenSet())
    await expect(pending).resolves.toBe(false)
    expect(runtime.sessions.isAuthenticated).toBe(false)
    expect(localStorage.length).toBe(0)
    runtime.sessions.connect(runtime.profile.identity, { resolveToken: async () => tokenSet() })
    await expect(runtime.sessions.ensureValid()).resolves.toBe(true)
  })

  /** Reset не позволяет ответу старого source перезаписать новую session. */
  it('сохраняет новую сессию при позднем ответе после reset', async () => {
    const runtime = createRuntime()
    runtime.sessions.configureDefault(runtime.profile)
    let release!: (value: ReturnType<typeof tokenSet>) => void
    runtime.sessions.connect(runtime.profile.identity, {
      resolveToken: () => new Promise((resolve) => { release = resolve }),
    })
    const pending = runtime.sessions.ensureValid()
    await Promise.resolve()
    runtime.sessions.resetRuntime()
    runtime.sessions.configureDefault(runtime.profile)
    runtime.sessions.connect(runtime.profile.identity, { resolveToken: async () => tokenSet({ accessToken: 'new' }) })
    await runtime.sessions.ensureValid()
    release(tokenSet({ accessToken: 'old' }))
    await expect(pending).resolves.toBe(false)
    expect((await runtime.requests.resolve({ mode: 'inherit' })).accessToken).toBe('new')
  })

  /** Userinfo загружается отдельно и тоже не должен воскрешать token после выхода. */
  it('не восстанавливает сессию поздним userinfo после logout', async () => {
    const runtime = createRuntime()
    runtime.sessions.configureDefault(runtime.profile)
    let release!: (value: Record<string, unknown>) => void
    runtime.sessions.connect(runtime.profile.identity, {
      resolveToken: async () => tokenSet(),
      loadUserInfo: () => new Promise((resolve) => { release = resolve }),
    })
    const pending = runtime.sessions.ensureUserInfo()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await runtime.sessions.logout()
    release({ sub: 'old-user' })
    await expect(pending).resolves.toBeNull()
    expect(runtime.sessions.isAuthenticated).toBe(false)
    expect(runtime.sessions.userInfo).toBeNull()
  })

  it('не сохраняет поздний refresh в storage после logout', async () => {
    let release!: (value: ReturnType<typeof tokenSet>) => void
    const runtime = createRuntime(undefined, {
      id: 'oidc',
      label: 'Test',
      validate: () => {},
      authenticate: async () => tokenSet(),
      refresh: () => new Promise((resolve) => { release = resolve }),
    })
    runtime.sessions.configureDefault(runtime.profile)
    await runtime.sessions.ensureValid()
    expect(localStorage.length).toBe(1)
    const refresh = runtime.sessions.ensureValid({ forceRefresh: true })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await runtime.sessions.logout()
    release(tokenSet({ accessToken: 'late-refresh' }))
    await expect(refresh).resolves.toBe(false)
    expect(runtime.sessions.isAuthenticated).toBe(false)
    expect(localStorage.length).toBe(0)
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
  adapter: AuthProfileAdapter = new OidcAuthAdapter() as AuthProfileAdapter,
) {
  const profile = authProfile()
  const adapters = new AuthAdapterRegistry()
  adapters.register(adapter)
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
