import type {
  AuthAdapterContext,
  AuthProfileAdapter,
  AuthProfileSchema,
  AuthTokenSet,
} from '@/domain/types/auth/auth-profile.types'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthAdapterRegistry } from '@/model/modules/security/auth/AuthAdapterRegistry'
import { AuthProfileRegistry } from '@/model/modules/security/auth/AuthProfileRegistry'
import { AuthRequestResolver } from '@/model/modules/security/auth/AuthRequestResolver'
import { AuthSessionManager } from '@/model/modules/security/auth/AuthSessionManager'
import { AuthSessionStore } from '@/model/modules/security/auth/AuthSessionStore'
import { authProfile, jwt, MemoryStorage, tokenSet } from '@/test/security/auth-test-helpers'

describe('AuthSessionManager lifecycle and request policies', () => {
  let localStorage: MemoryStorage
  let sessionStorage: MemoryStorage
  let now: number

  beforeEach(() => {
    now = 100_000
    localStorage = new MemoryStorage()
    sessionStorage = new MemoryStorage()
    vi.stubGlobal('localStorage', localStorage)
    vi.stubGlobal('sessionStorage', sessionStorage)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('logs in interactively, exposes safe context/userinfo and clears locally when logout fails', async () => {
    const profile = authProfile()
    const adapter = fakeAdapter({
      authenticate: async context => {
        expect(context.credentials).toEqual({ username: 'alice', password: 'secret' })
        return tokenSet({
          accessToken: jwt({ sub: 'alice', tenant: 'must-not-enter-context' }),
          accessExpiresAt: now + 60_000,
        })
      },
      loadUserInfo: async () => ({ sub: 'alice', name: 'Alice' }),
      logout: async () => {
        throw new Error('Keycloak unavailable')
      },
    })
    const runtime = createRuntime([profile], adapter, () => now)
    runtime.sessions.configureDefault(profile)

    await runtime.sessions.login({ username: 'alice', password: 'secret' })
    expect(runtime.sessions.isAuthenticated).toBe(true)
    expect(runtime.sessions.profileIdentity).toBe(profile.identity)
    expect(runtime.sessions.context).toEqual({
      authenticated: true,
      subject: 'alice',
      profileIdentity: profile.identity,
    })
    expect(runtime.sessions.context).not.toHaveProperty('tenantIdentity')
    expect(await runtime.sessions.ensureUserInfo()).toEqual({ sub: 'alice', name: 'Alice' })

    await runtime.sessions.logout()
    expect(runtime.sessions.isAuthenticated).toBe(false)
    expect(localStorage.length).toBe(0)
  })

  it('logs in by profile identity without changing the inherited default profile', async () => {
    const defaultProfile = authProfile({ identity: 'default-auth' })
    const runtimeProfile = serviceProfile({ identity: 'aodb-auth' })
    const authenticate = vi.fn(async (context: AuthAdapterContext) => tokenSet({
      accessToken: jwt({ sub: context.profile.identity }),
      accessExpiresAt: now + 60_000,
    }))
    const runtime = createRuntime(
      [defaultProfile, runtimeProfile],
      fakeAdapter({ authenticate }),
      () => now,
    )
    runtime.sessions.configureDefault(defaultProfile)
    await runtime.sessions.loginWithProfile(defaultProfile.identity, {
      username: 'alice',
      password: 'secret',
    })

    await runtime.sessions.loginWithProfile(runtimeProfile.identity, {
      username: 'alice',
      password: 'secret',
    })

    expect(runtime.sessions.profileIdentity).toBe(defaultProfile.identity)
    expect(runtime.sessions.context.subject).toBe(defaultProfile.identity)
    expect(await runtime.requests.resolve({ mode: 'inherit' })).toEqual(expect.objectContaining({
      profileIdentity: defaultProfile.identity,
      subject: defaultProfile.identity,
    }))
    expect(authenticate).toHaveBeenCalledWith(expect.objectContaining({
      profile: runtimeProfile,
      credentials: { username: 'alice', password: 'secret' },
    }))
  })

  it('uses a host-owned session source without persisting or refreshing its tokens through the profile adapter', async () => {
    const profile = authProfile()
    const adapter = fakeAdapter()
    const runtime = createRuntime([profile], adapter, () => now)
    runtime.sessions.configureDefault(profile)
    await runtime.sessions.login({ username: 'alice', password: 'secret' })
    expect(localStorage.length).toBe(1)

    const resolveToken = vi.fn(async () => tokenSet({
      accessToken: jwt({ sub: 'external-user' }),
      accessExpiresAt: now + 60_000,
    }))
    const logout = vi.fn(async () => undefined)
    runtime.sessions.connect(profile.identity, {
      resolveToken,
      logout,
      loadUserInfo: async () => ({ sub: 'external-user', name: 'External User' }),
    })

    expect(localStorage.length).toBe(0)
    const [first, second] = await Promise.all([
      runtime.requests.resolve({ mode: 'inherit' }),
      runtime.requests.resolve({ mode: 'inherit' }),
    ])
    expect(first.headers).toEqual({ Authorization: expect.stringContaining('.') })
    expect(second.subject).toBe('external-user')
    expect(resolveToken).toHaveBeenCalledTimes(1)
    expect(resolveToken).toHaveBeenCalledWith({ forceRefresh: false, minValiditySeconds: 30 })
    expect(await runtime.sessions.ensureUserInfo()).toEqual({ sub: 'external-user', name: 'External User' })
    expect(localStorage.length).toBe(0)

    await runtime.sessions.logout()
    expect(logout).toHaveBeenCalledTimes(1)
    expect(runtime.sessions.isAuthenticated).toBe(false)
  })

  it('auto-authenticates a service profile once for parallel inherited requests', async () => {
    const profile = serviceProfile()
    const authenticate = vi.fn(async () => tokenSet({ accessExpiresAt: now + 60_000 }))
    const runtime = createRuntime([profile], fakeAdapter({ authenticate }), () => now)
    runtime.sessions.configureDefault(profile)

    const results = await Promise.all([
      runtime.requests.resolve({ mode: 'inherit' }),
      runtime.requests.resolve({ mode: 'inherit' }),
      runtime.requests.resolve({ mode: 'inherit' }),
    ])

    expect(authenticate).toHaveBeenCalledTimes(1)
    expect(results).toHaveLength(3)
    expect(results[0]).toEqual(expect.objectContaining({
      profileIdentity: profile.identity,
      headers: { Authorization: 'Bearer access-token' },
    }))
  })

  it('can restore or refresh a service session without starting a new service login', async () => {
    const profile = serviceProfile()
    const authenticate = vi.fn(async () => tokenSet({ accessExpiresAt: now + 60_000 }))
    const runtime = createRuntime([profile], fakeAdapter({ authenticate }), () => now)
    runtime.sessions.configureDefault(profile)

    expect(await runtime.sessions.ensureValid({ allowServiceLogin: false })).toBe(false)
    expect(authenticate).not.toHaveBeenCalled()
  })

  it('resolves inherit as anonymous when no default profile exists', async () => {
    const runtime = createRuntime([], fakeAdapter(), () => now)

    expect(await runtime.requests.resolve({ mode: 'inherit' })).toEqual({
      profileIdentity: null,
      headers: {},
      expiresAt: null,
    })
  })

  it('supports none/profile policies without changing the application identity', async () => {
    const application = authProfile()
    const isolated = serviceProfile({ identity: 'isolated-auth' })
    const authenticate = vi.fn(async (context: AuthAdapterContext) => tokenSet({
      accessToken: jwt({ sub: context.profile.identity }),
      accessExpiresAt: now + 60_000,
    }))
    const runtime = createRuntime([application, isolated], fakeAdapter({ authenticate }), () => now)
    runtime.sessions.configureDefault(application)
    await runtime.sessions.login({ username: 'alice', password: 'secret' })
    const applicationContext = runtime.sessions.context

    expect(await runtime.requests.resolve({ mode: 'none' })).toEqual({
      profileIdentity: null,
      headers: {},
      expiresAt: null,
    })
    const result = await runtime.requests.resolve({ mode: 'profile', profileIdentity: isolated.identity })
    expect(result.profileIdentity).toBe(isolated.identity)
    expect(result.subject).toBe(isolated.identity)
    expect(runtime.sessions.profileIdentity).toBe(application.identity)
    expect(runtime.sessions.context).toEqual(applicationContext)
  })

  it('refreshes within skew and force-refreshes through one parallel single-flight', async () => {
    const profile = authProfile()
    const authenticate = vi.fn(async () => tokenSet({ accessExpiresAt: now + 10_000 }))
    const refresh = vi.fn(async () => tokenSet({ accessToken: 'refreshed', accessExpiresAt: now + 120_000 }))
    const runtime = createRuntime([profile], fakeAdapter({ authenticate, refresh }), () => now)
    runtime.sessions.configureDefault(profile)
    await runtime.sessions.login({ username: 'alice', password: 'secret' })

    const first = await Promise.all([
      runtime.sessions.ensureValid(),
      runtime.sessions.ensureValid(),
      runtime.sessions.ensureValid(),
    ])
    expect(first).toEqual([true, true, true])
    expect(refresh).toHaveBeenCalledTimes(1)

    await Promise.all([
      runtime.requests.resolve({ mode: 'inherit' }, { forceRefresh: true }),
      runtime.requests.resolve({ mode: 'inherit' }, { forceRefresh: true }),
    ])
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('keeps a still-usable token when refresh fails transiently', async () => {
    const profile = authProfile()
    const runtime = createRuntime([profile], fakeAdapter({
      authenticate: async () => tokenSet({ accessExpiresAt: now + 10_000 }),
      refresh: async () => {
        throw new Error('network unavailable')
      },
    }), () => now)
    runtime.sessions.configureDefault(profile)
    await runtime.sessions.login({ username: 'alice', password: 'secret' })

    expect(await runtime.sessions.ensureValid()).toBe(true)
    expect(runtime.sessions.isAuthenticated).toBe(true)
    expect(localStorage.length).toBe(1)
  })

  it('makes interactive session anonymous after invalid_grant and re-authenticates service session', async () => {
    const invalidGrant = Object.assign(new Error('invalid grant'), { code: 'invalid_grant' })
    const interactive = authProfile()
    const interactiveRuntime = createRuntime([interactive], fakeAdapter({
      authenticate: async () => tokenSet({ accessExpiresAt: now - 1, refreshExpiresAt: now + 60_000 }),
      refresh: async () => { throw invalidGrant },
    }), () => now)
    interactiveRuntime.sessions.configureDefault(interactive)
    await interactiveRuntime.sessions.login({ username: 'alice', password: 'secret' })
    expect(await interactiveRuntime.sessions.ensureValid()).toBe(false)
    expect(interactiveRuntime.sessions.isAuthenticated).toBe(false)

    const service = serviceProfile()
    const authenticate = vi.fn()
      .mockResolvedValueOnce(tokenSet({ accessExpiresAt: now + 1_000, refreshExpiresAt: now + 60_000 }))
      .mockResolvedValueOnce(tokenSet({ accessToken: 'reauthenticated', accessExpiresAt: now + 60_000 }))
    const serviceRuntime = createRuntime([service], fakeAdapter({
      authenticate,
      refresh: async () => { throw invalidGrant },
    }), () => now)
    serviceRuntime.sessions.configureDefault(service)
    expect(await serviceRuntime.sessions.ensureValid()).toBe(true)
    now += 2_000
    expect(await serviceRuntime.sessions.ensureValid()).toBe(true)
    expect(authenticate).toHaveBeenCalledTimes(2)
  })

  it('restores persisted default profile session after reset but drops memory-only sessions', async () => {
    const profile = authProfile()
    const adapter = fakeAdapter({
      authenticate: async () => tokenSet({ accessExpiresAt: now + 60_000 }),
    })
    const store = new AuthSessionStore()
    const runtime = createRuntime([profile], adapter, () => now, store)
    runtime.sessions.configureDefault(profile)
    await runtime.sessions.login({ username: 'alice', password: 'secret' })
    runtime.sessions.resetRuntime()
    expect(runtime.sessions.isAuthenticated).toBe(false)

    const restored = createRuntime([profile], adapter, () => now, store)
    restored.sessions.configureDefault(profile)
    expect(restored.sessions.isAuthenticated).toBe(true)

    const memoryProfile = serviceProfile({ identity: 'memory-auth', adapterId: 'keycloak', persist: 'memory' })
    const memoryRuntime = createRuntime([memoryProfile], adapter, () => now, store)
    memoryRuntime.sessions.configureDefault(memoryProfile)
    await memoryRuntime.sessions.ensureValid()
    memoryRuntime.sessions.resetRuntime()
    const memoryRestored = createRuntime([memoryProfile], adapter, () => now, store)
    memoryRestored.sessions.configureDefault(memoryProfile)
    expect(memoryRestored.sessions.isAuthenticated).toBe(false)
  })

  it('removes a finally expired persisted snapshot during restore', () => {
    const profile = authProfile()
    const store = new AuthSessionStore()
    store.write('workspace', profile, {
      version: 1,
      profileIdentity: profile.identity,
      adapterId: profile.adapterId,
      token: tokenSet({ accessExpiresAt: now - 2_000, refreshExpiresAt: now - 1_000 }),
      updatedAt: '2026-08-10T00:00:00.000Z',
    })
    const runtime = createRuntime([profile], fakeAdapter(), () => now, store)

    runtime.sessions.configureDefault(profile)

    expect(runtime.sessions.isAuthenticated).toBe(false)
    expect(localStorage.length).toBe(0)
  })
})

interface FakeAdapterOverrides {
  authenticate?: (context: AuthAdapterContext) => Promise<AuthTokenSet>
  refresh?: (context: AuthAdapterContext) => Promise<AuthTokenSet>
  logout?: (context: AuthAdapterContext) => Promise<void>
  loadUserInfo?: (context: AuthAdapterContext) => Promise<Record<string, unknown> | null>
}

function fakeAdapter(overrides: FakeAdapterOverrides = {}): AuthProfileAdapter {
  return {
    id: 'keycloak',
    label: 'Fake Keycloak',
    validate: vi.fn(),
    authenticate: overrides.authenticate ?? vi.fn(async () => tokenSet()),
    refresh: overrides.refresh ?? vi.fn(async context => context.token ?? tokenSet()),
    logout: overrides.logout ?? vi.fn(async () => undefined),
    loadUserInfo: overrides.loadUserInfo ?? vi.fn(async () => null),
  }
}

function serviceProfile(overrides: Partial<AuthProfileSchema> = {}): AuthProfileSchema {
  const base = authProfile()
  return authProfile({
    identity: 'service-auth',
    config: { ...base.config, loginMode: 'service' },
    credentialRefs: { username: 'SERVICE_USER', password: 'SERVICE_PASSWORD' },
    ...overrides,
  })
}

function createRuntime(
  profiles: AuthProfileSchema[],
  adapter: AuthProfileAdapter,
  readNow: () => number,
  store = new AuthSessionStore(),
) {
  const adapters = new AuthAdapterRegistry()
  adapters.register(adapter)
  const registry = new AuthProfileRegistry(adapters, {
    listProfiles: () => profiles as any,
    getDefaultIdentity: () => profiles[0]?.identity ?? null,
    getCredentialResolver: () => async ({ credential }) => credential,
    getSignal: () => undefined,
  })
  const sessions = new AuthSessionManager(registry, adapters, store, {
    getWorkspaceIdentity: () => 'workspace',
    onSessionChange: vi.fn(),
    now: readNow,
  })
  return {
    profiles: registry,
    sessions,
    requests: new AuthRequestResolver(registry, sessions),
  }
}
