import type {
  AuthAdapterContext,
  AuthProfileAdapter,
  AuthProfileSchema,
  AuthTokenSet,
} from '@/domain/types/auth/auth-profile.types'
import type { KeycloakAuthTransport } from '@/domain/types/auth/auth-runtime.types'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthAdapterRegistry } from '@/model/modules/security/auth/AuthAdapterRegistry'
import { AuthProfileRegistry } from '@/model/modules/security/auth/AuthProfileRegistry'
import { BearerAuthAdapter } from '@/model/modules/security/auth/adapters/BearerAuthAdapter'
import { KeycloakAuthAdapter } from '@/model/modules/security/auth/adapters/KeycloakAuthAdapter'
import { authProfile, tokenSet } from '@/test/security/auth-test-helpers'

describe('built-in auth adapters', () => {
  let transport: KeycloakAuthTransport

  beforeEach(() => {
    transport = {
      passwordGrant: vi.fn(async () => ({
        access_token: 'access',
        refresh_token: 'refresh',
        expires_in: 60,
        refresh_expires_in: 120,
        id_token: 'id-token',
      })),
      refreshGrant: vi.fn(async () => ({ access_token: 'refreshed', expires_in: 60 })),
      logout: vi.fn(async () => undefined),
      getUserInfo: vi.fn(async () => ({ sub: 'user-1', name: 'User' })),
    }
  })

  it('rejects legacy ids, forbidden Keycloak fields and invalid mode contracts', () => {
    const registry = new AuthAdapterRegistry()
    registry.register(new KeycloakAuthAdapter(String, () => transport))
    registry.register(new BearerAuthAdapter())

    for (const adapterId of ['keycloak_form', 'keycloak_manual', 'manual_token'])
      expect(() => registry.validate(authProfile({ adapterId }))).toThrow('Unknown auth adapter')

    expect(() => registry.validate(authProfile({
      config: { ...authProfile().config, password: 'raw-secret' },
    }))).toThrow('Unsupported Keycloak config field')
    expect(() => registry.validate(authProfile({
      credentialRefs: { username: 'USER' },
    }))).toThrow('must not persist credentialRefs')
    expect(() => registry.validate(authProfile({
      config: { ...authProfile().config, loginMode: 'service' },
      credentialRefs: { username: 'USER' },
    }))).toThrow('credentialRefs.password')
  })

  it('uses transient credentials for interactive login and resolver refs for service login', async () => {
    const adapter = new KeycloakAuthAdapter(String, () => transport, () => 1_000)
    const interactive = authProfile()
    await adapter.authenticate(context(interactive, {
      credentials: { username: 'alice', password: 'secret' },
    }))
    expect(transport.passwordGrant).toHaveBeenLastCalledWith(
      expect.objectContaining({ username: 'alice', password: 'secret' }),
      undefined,
    )

    const service = authProfile({
      identity: 'service',
      config: { ...interactive.config, loginMode: 'service' },
      credentialRefs: { username: 'SERVICE_USER', password: 'SERVICE_PASSWORD' },
    })
    const resolveCredential = vi.fn(async (credential: string) => credential === 'username' ? 'robot' : 'robot-secret')
    await adapter.authenticate(context(service, { resolveCredential }))
    expect(resolveCredential).toHaveBeenCalledTimes(2)
    expect(transport.passwordGrant).toHaveBeenLastCalledWith(
      expect.objectContaining({ username: 'robot', password: 'robot-secret' }),
      undefined,
    )
  })

  it('resolves bearer tokens only through the host resolver and enforces memory persistence', async () => {
    const adapter = new BearerAuthAdapter()
    const profile = authProfile({
      adapterId: 'bearer',
      config: {},
      credentialRefs: { token: 'AODB_TOKEN' },
      persist: 'memory',
    })
    const resolveCredential = vi.fn(async () => 'opaque-token')

    expect(await adapter.authenticate(context(profile, { resolveCredential }))).toEqual({
      accessToken: 'opaque-token',
      accessExpiresAt: null,
    })
    expect(resolveCredential).toHaveBeenCalledWith('token')
    expect(() => adapter.validate({ ...profile, persist: 'localStorage' })).toThrow('persist=memory')
    expect(() => adapter.validate({ ...profile, config: { token: 'raw' } })).toThrow('config must be empty')
  })
})

describe('AuthProfileRegistry', () => {
  it('allows registered plugin ids and rejects missing or inactive defaults', () => {
    const profiles = [authProfile({ adapterId: 'company-auth' })]
    const adapters = new AuthAdapterRegistry()
    adapters.register(fakeAdapter('company-auth'))
    let defaultIdentity: string | null = profiles[0]!.identity
    const registry = profileRegistry(adapters, profiles, () => defaultIdentity)

    expect(registry.getDefault()?.adapterId).toBe('company-auth')
    defaultIdentity = 'missing'
    expect(() => registry.getDefault()).toThrow('Default auth profile is missing')
    profiles[0]!.active = false
    defaultIdentity = profiles[0]!.identity
    expect(() => registry.getDefault()).toThrow('inactive')
  })

  it('tests a profile ephemerally, logs out best-effort and never returns tokens', async () => {
    const logout = vi.fn(async () => {
      throw new Error('provider unavailable')
    })
    const adapter = fakeAdapter('company-auth', logout)
    const adapters = new AuthAdapterRegistry()
    adapters.register(adapter)
    const profile = authProfile({ adapterId: 'company-auth' })
    const registry = profileRegistry(adapters, [profile], () => profile.identity)

    const result = await registry.test(profile, { credentials: { username: 'transient' } })

    expect(result).toEqual(expect.objectContaining({
      authenticated: true,
      profileIdentity: profile.identity,
    }))
    expect(result).not.toHaveProperty('accessToken')
    expect(result).not.toHaveProperty('headers')
    expect(logout).toHaveBeenCalledTimes(1)
  })
})

function context(
  profile: AuthProfileSchema,
  overrides: Partial<AuthAdapterContext> = {},
): AuthAdapterContext {
  return {
    profile,
    resolveCredential: async credential => credential,
    ...overrides,
  }
}

function fakeAdapter(id: string, logout = vi.fn(async () => undefined)): AuthProfileAdapter {
  return {
    id,
    label: id,
    validate: vi.fn(),
    authenticate: vi.fn(async (): Promise<AuthTokenSet> => tokenSet()),
    loadUserInfo: vi.fn(async () => ({ sub: 'test-user' })),
    logout,
  }
}

function profileRegistry(
  adapters: AuthAdapterRegistry,
  profiles: AuthProfileSchema[],
  getDefaultIdentity: () => string | null,
): AuthProfileRegistry {
  return new AuthProfileRegistry(adapters, {
    listProfiles: () => profiles as any,
    getDefaultIdentity,
    getCredentialResolver: () => async ({ ref }) => ref,
    getSignal: () => undefined,
  })
}
