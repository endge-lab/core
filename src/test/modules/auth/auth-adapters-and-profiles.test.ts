import { describe, expect, it, vi } from 'vitest'

import { BasicAuthAdapter } from '@/modules/auth/adapters/BasicAuthAdapter'
import { BearerAuthAdapter } from '@/modules/auth/adapters/BearerAuthAdapter'
import { OAuth2ClientCredentialsAuthAdapter } from '@/modules/auth/adapters/OAuth2ClientCredentialsAuthAdapter'
import { OAuth2PasswordAuthAdapter } from '@/modules/auth/adapters/OAuth2PasswordAuthAdapter'
import { OidcAuthAdapter } from '@/modules/auth/adapters/OidcAuthAdapter'
import { AuthInteractionRequiredError } from '@/modules/auth/domain/AuthInteractionRequiredError'
import { AuthAdapterRegistry } from '@/modules/auth/services/AuthAdapterRegistry'
import { AuthProfileRegistry } from '@/modules/auth/services/AuthProfileRegistry'
import { authProfile } from '@/test/modules/auth/auth-test-helpers'

describe('universal auth adapters', () => {
  it('validates OIDC and requires host interaction', async () => {
    const profile = authProfile()
    const adapter = new OidcAuthAdapter()
    expect(() => adapter.validate(profile)).not.toThrow()
    await expect(adapter.authenticate(context(profile))).rejects.toBeInstanceOf(AuthInteractionRequiredError)
  })

  it('materializes Basic and Bearer headers from literal or variable values', async () => {
    const basic = authProfile({ adapterId: 'basic', config: {}, credentials: { username: 'alice', password: '{PASSWORD}' }, session: undefined })
    const bearer = authProfile({ adapterId: 'bearer', config: {}, credentials: { token: '{TOKEN}' }, session: undefined })
    const resolve = (value: unknown) => value === '{PASSWORD}' ? 'secret' : value === '{TOKEN}' ? 'opaque' : String(value)
    await expect(new BasicAuthAdapter().authenticate(context(basic, resolve))).resolves.toEqual(expect.objectContaining({ headers: { Authorization: 'Basic YWxpY2U6c2VjcmV0' } }))
    await expect(new BearerAuthAdapter().authenticate(context(bearer, resolve))).resolves.toEqual(expect.objectContaining({ headers: { Authorization: 'Bearer opaque' } }))
  })

  it('performs client_secret_basic grant', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 'service-token', expires_in: 60 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const profile = authProfile({
      adapterId: 'oauth2-client-credentials',
      config: { tokenEndpoint: 'https://issuer/token', clientId: 'client', scopes: ['read'], clientAuthentication: 'client_secret_basic' },
      credentials: { clientSecret: 'secret' },
    })
    const token = await new OAuth2ClientCredentialsAuthAdapter().authenticate(context(profile))
    expect(token.headers).toEqual({ Authorization: 'Bearer service-token' })
    expect(fetchMock).toHaveBeenCalledWith('https://issuer/token', expect.objectContaining({ method: 'POST' }))
    vi.unstubAllGlobals()
  })

  it('performs password grant and refreshes its token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'user-token', refresh_token: 'refresh-token', id_token: 'id-token', expires_in: 60 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'refreshed-token', expires_in: 60 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const profile = authProfile({
      adapterId: 'oauth2-password',
      config: { tokenEndpoint: 'https://issuer/token', clientId: 'public-client', scopes: ['openid', 'email'] },
      credentials: { username: 'alice', password: 'secret' },
    })
    const adapter = new OAuth2PasswordAuthAdapter()
    const token = await adapter.authenticate(context(profile))
    const initialBody = fetchMock.mock.calls[0][1].body as URLSearchParams
    expect(initialBody.get('grant_type')).toBe('password')
    expect(initialBody.get('username')).toBe('alice')
    expect(token).toEqual(expect.objectContaining({ accessToken: 'user-token', refreshToken: 'refresh-token', idToken: 'id-token' }))

    const refreshed = await adapter.refresh({ ...context(profile), token })
    const refreshBody = fetchMock.mock.calls[1][1].body as URLSearchParams
    expect(refreshBody.get('grant_type')).toBe('refresh_token')
    expect(refreshBody.get('refresh_token')).toBe('refresh-token')
    expect(refreshed).toEqual(expect.objectContaining({ accessToken: 'refreshed-token', refreshToken: 'refresh-token' }))
    vi.unstubAllGlobals()
  })

  it('rejects an unresolved credential reference instead of sending it literally', async () => {
    const profile = authProfile({ adapterId: 'bearer', config: {}, credentials: { token: '{MISSING_TOKEN}' }, session: undefined })
    const adapters = new AuthAdapterRegistry()
    adapters.register(new BearerAuthAdapter())
    const profiles = new AuthProfileRegistry(adapters, {
      listProfiles: () => [profile] as any,
      getDefaultIdentity: () => profile.identity,
      resolveValue: value => String(value),
      getSignal: () => undefined,
    })
    await expect(profiles.createAdapterContext(profile).resolveCredential('token'))
      .rejects
      .toThrow('Credential is unavailable')
  })
})

function context(profile: ReturnType<typeof authProfile>, resolve = (value: unknown) => String(value)) {
  return {
    profile,
    resolveValue: resolve,
    resolveCredential: async (key: string) => resolve(profile.credentials[key]),
  }
}
