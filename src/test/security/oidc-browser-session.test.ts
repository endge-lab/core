import type { StateStore, UserManagerSettings } from 'oidc-client-ts'

import type { OidcBrowserSessionOptions } from '@/domain/types/auth/auth-profile.types'
import { User } from 'oidc-client-ts'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OidcBrowserSession_Adapter } from '@/model/adapters/auth/OidcBrowserSession_Adapter'
import { MemoryStorage } from '@/test/security/auth-test-helpers'

const oidc = vi.hoisted(() => ({ popupCallbackCalls: 0 }))

vi.mock('oidc-client-ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('oidc-client-ts')>()
  class FakeUserManager {
    public constructor(private readonly _settings: UserManagerSettings) {}

    private get _key(): string { return `user:${this._settings.authority}:${this._settings.client_id}` }

    public async getUser(): Promise<User | null> {
      const raw = await (this._settings.userStore as StateStore).get(this._key)
      return raw ? User.fromStorageString(raw) : null
    }

    public async signinPopup(): Promise<User> {
      const user = createUser()
      await (this._settings.userStore as StateStore).set(this._key, user.toStorageString())
      return user
    }

    public async signinRedirect(): Promise<void> {}

    public async signinRedirectCallback(): Promise<User> {
      const user = createUser()
      await (this._settings.userStore as StateStore).set(this._key, user.toStorageString())
      return user
    }

    public async signinPopupCallback(): Promise<void> { oidc.popupCallbackCalls += 1 }
    public async signinSilent(): Promise<User | null> { return this.getUser() }
    public async signoutPopup(): Promise<void> {}
    public async signoutRedirect(): Promise<void> {}
    public async removeUser(): Promise<void> { await (this._settings.userStore as StateStore).remove(this._key) }
  }
  return { ...actual, UserManager: FakeUserManager }
})

describe('oidcBrowserSession_Service', () => {
  let localStorage: MemoryStorage
  let sessionStorage: MemoryStorage

  beforeEach(() => {
    localStorage = new MemoryStorage()
    sessionStorage = new MemoryStorage()
    vi.stubGlobal('localStorage', localStorage)
    vi.stubGlobal('sessionStorage', sessionStorage)
    oidc.popupCallbackCalls = 0
  })

  afterEach(() => vi.unstubAllGlobals())

  it('keeps a non-persisted refresh token only in the current runtime', async () => {
    const source = new OidcBrowserSession_Adapter(options(false))
    const login = await source.loginPopup()
    const raw = localStorage.getItem(localStorage.key(0) ?? '') ?? ''
    expect(login.refreshToken).toBe('refresh-token')
    expect(raw).not.toContain('refresh-token')
    await expect(source.resolveToken({ forceRefresh: false, minValiditySeconds: 0 }))
      .resolves
      .toEqual(expect.objectContaining({ refreshToken: 'refresh-token' }))

    const restored = new OidcBrowserSession_Adapter(options(false))
    await expect(restored.resolveToken({ forceRefresh: false, minValiditySeconds: 0 }))
      .resolves
      .toEqual(expect.not.objectContaining({ refreshToken: expect.anything() }))
  })

  it('persists refresh token only after opt-in and supports both callbacks', async () => {
    const source = new OidcBrowserSession_Adapter(options(true))
    await source.completeRedirectCallback('https://app.test/callback?code=code&state=state')
    expect(localStorage.getItem(localStorage.key(0) ?? '')).toContain('refresh-token')
    await source.completePopupCallback('https://app.test/popup?code=code&state=state')
    expect(oidc.popupCallbackCalls).toBe(1)
  })
})

function options(persistRefreshToken: boolean): OidcBrowserSessionOptions {
  return {
    issuer: 'https://issuer.example',
    clientId: 'web',
    scopes: ['openid', 'profile'],
    redirectUri: 'https://app.test/callback',
    popupRedirectUri: 'https://app.test/popup',
    session: { storage: 'localStorage', persistRefreshToken },
    storageNamespace: 'test',
    profileIdentity: 'oidc-main',
    flow: 'popup',
  }
}

function createUser(): User {
  return new User({
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    token_type: 'Bearer',
    profile: {
      sub: 'user',
      iss: 'https://issuer.example',
      aud: 'web',
      exp: Math.floor(Date.now() / 1000) + 300,
      iat: Math.floor(Date.now() / 1000),
    },
    expires_at: Math.floor(Date.now() / 1000) + 300,
  })
}
