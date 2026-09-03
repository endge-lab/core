import type { StateStore, User, UserManagerSettings } from 'oidc-client-ts'

import type {
  AuthSessionSource,
  AuthSessionSourceResolveOptions,
  AuthTokenSet,
  OidcBrowserSessionOptions,
} from '@/modules/auth/domain/types/auth-profile.types'
import {
  InMemoryWebStorage,
  UserManager,
  WebStorageStateStore,
} from 'oidc-client-ts'

const POPUP_OPTIONS_KEY = 'endge:oidc:popup-callback-options'

class SanitizingStateStore implements StateStore {
  private readonly _volatileRefreshTokens = new Map<string, string>()

  public constructor(
    private readonly _delegate: StateStore,
    private readonly _persistRefreshToken: boolean,
  ) {}

  public async set(key: string, value: string): Promise<void> {
    if (this._persistRefreshToken) {
      this._volatileRefreshTokens.delete(key)
      await this._delegate.set(key, value)
      return
    }
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>
      const refreshToken = String(parsed.refresh_token ?? '')
      if (refreshToken) {
        this._volatileRefreshTokens.set(key, refreshToken)
      }
      else { this._volatileRefreshTokens.delete(key) }
      delete parsed.refresh_token
      await this._delegate.set(key, JSON.stringify(parsed))
    }
    catch {
      await this._delegate.set(key, value)
    }
  }

  public async get(key: string): Promise<string | null> {
    const value = await this._delegate.get(key)
    const refreshToken = this._volatileRefreshTokens.get(key)
    if (!value || !refreshToken || this._persistRefreshToken) {
      return value
    }
    try {
      return JSON.stringify({ ...JSON.parse(value), refresh_token: refreshToken })
    }
    catch {
      return value
    }
  }

  public async remove(key: string): Promise<string | null> {
    this._volatileRefreshTokens.delete(key)
    return this._delegate.remove(key)
  }

  public getAllKeys(): Promise<string[]> {
    return this._delegate.getAllKeys()
  }

  /** Принимает User, возвращённого popup/redirect callback, в память текущей вкладки. */
  public async adopt(key: string, user: User): Promise<void> {
    await this.set(key, user.toStorageString())
  }
}

/** Общий browser OIDC runtime для popup и redirect Authorization Code + PKCE flows. */
export class OidcBrowserSession_Adapter implements AuthSessionSource {
  private readonly _userStore: SanitizingStateStore
  private readonly _manager: UserManager

  public constructor(public readonly options: OidcBrowserSessionOptions) {
    this._userStore = createUserStore(options)
    this._manager = new UserManager(createSettings(options, this._userStore))
  }

  /** Возвращает сохранённого пользователя без запуска интерактивного flow. */
  public async hasSession(): Promise<boolean> {
    return isUsable(await this._manager.getUser())
  }

  /** Открывает внешний OIDC login в popup и сохраняет полученную session. */
  public async loginPopup(): Promise<AuthTokenSet> {
    globalThis.sessionStorage.setItem(POPUP_OPTIONS_KEY, JSON.stringify(this.options))
    const user = await this._manager.signinPopup()
    await this._userStore.adopt(userStoreKey(this.options), user)
    return requireToken(user, this.options.profileIdentity)
  }

  /** Завершает callback в отдельном popup без загрузки Domain. */
  public static async completeStoredPopupCallback(url: string = globalThis.location?.href ?? ''): Promise<void> {
    const raw = globalThis.sessionStorage.getItem(POPUP_OPTIONS_KEY)
    if (!raw) {
      throw new Error('[EndgeAuth] OIDC popup callback settings are unavailable')
    }
    const options = JSON.parse(raw) as OidcBrowserSessionOptions
    const source = new OidcBrowserSession_Adapter(options)
    await source.completePopupCallback(url)
  }

  /** Перенаправляет текущую вкладку на внешний OIDC login. */
  public async loginRedirect(): Promise<never> {
    await this._manager.signinRedirect()
    return await new Promise<never>(() => undefined)
  }

  /** Завершает redirect callback и сохраняет session. */
  public async completeRedirectCallback(url: string = globalThis.location?.href ?? ''): Promise<AuthTokenSet> {
    const user = await this._manager.signinRedirectCallback(url)
    await this._userStore.adopt(userStoreKey(this.options), user)
    return requireToken(user, this.options.profileIdentity)
  }

  /** Завершает popup callback; результат передаётся opener через oidc-client-ts. */
  public async completePopupCallback(url: string = globalThis.location?.href ?? ''): Promise<void> {
    await this._manager.signinPopupCallback(url)
  }

  /** Возвращает актуальную session, используя refresh token только при необходимости. */
  public async resolveToken(options: AuthSessionSourceResolveOptions): Promise<AuthTokenSet | null> {
    let user = await this._manager.getUser()
    const expiresIn = user?.expires_in ?? null
    const needsRefresh = options.forceRefresh
      || !isUsable(user)
      || (expiresIn != null && expiresIn <= options.minValiditySeconds)
    if (needsRefresh && user?.refresh_token) {
      try {
        user = await this._manager.signinSilent()
        if (user) {
          await this._userStore.adopt(userStoreKey(this.options), user)
        }
      }
      catch {
        if (!isUsable(user)) {
          return null
        }
      }
    }
    return user && isUsable(user) ? toTokenSet(user) : null
  }

  /** Возвращает claims и при наличии endpoint дополняет их OIDC userinfo. */
  public async loadUserInfo(): Promise<Record<string, unknown> | null> {
    const user = await this._manager.getUser()
    if (!isUsable(user)) {
      return null
    }
    try {
      const discoveryURL = `${this.options.issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`
      const discovery = await fetch(discoveryURL).then(response => response.ok ? response.json() : null) as Record<string, unknown> | null
      const endpoint = String(discovery?.userinfo_endpoint ?? '').trim()
      if (!endpoint) {
        return user.profile as Record<string, unknown>
      }
      const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${user.access_token}` } })
      return response.ok ? await response.json() as Record<string, unknown> : user.profile as Record<string, unknown>
    }
    catch {
      return user.profile as Record<string, unknown>
    }
  }

  /** Завершает provider session выбранным host flow и всегда удаляет local user. */
  public async logout(): Promise<void> {
    try {
      if (this.options.flow === 'popup') {
        await this._manager.signoutPopup()
      }
      else { await this._manager.signoutRedirect() }
    }
    finally {
      await this._manager.removeUser()
    }
  }
}

function createUserStore(options: OidcBrowserSessionOptions): SanitizingStateStore {
  const prefix = `endge:oidc:${encodeURIComponent(options.storageNamespace)}:${encodeURIComponent(options.profileIdentity)}:`
  return new SanitizingStateStore(
    new WebStorageStateStore({ store: resolveStorage(options.session.storage), prefix }),
    options.session.persistRefreshToken,
  )
}

function createSettings(options: OidcBrowserSessionOptions, userStore: StateStore): UserManagerSettings {
  const prefix = `endge:oidc:${encodeURIComponent(options.storageNamespace)}:${encodeURIComponent(options.profileIdentity)}:`
  return {
    authority: options.issuer.replace(/\/+$/, ''),
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    popup_redirect_uri: options.popupRedirectUri ?? options.redirectUri,
    post_logout_redirect_uri: options.postLogoutRedirectUri ?? options.redirectUri,
    response_type: 'code',
    scope: [...new Set(['openid', ...options.scopes])].join(' '),
    userStore,
    stateStore: new WebStorageStateStore({ store: globalThis.sessionStorage, prefix: `${prefix}state:` }),
    automaticSilentRenew: false,
    monitorSession: false,
  }
}

function resolveStorage(storage: OidcBrowserSessionOptions['session']['storage']): Storage {
  if (storage === 'localStorage') {
    return globalThis.localStorage
  }
  if (storage === 'sessionStorage') {
    return globalThis.sessionStorage
  }
  return new InMemoryWebStorage()
}
function userStoreKey(options: OidcBrowserSessionOptions): string {
  return `user:${options.issuer.replace(/\/+$/, '')}:${options.clientId}`
}

function isUsable(user: User | null | undefined): user is User {
  return Boolean(user?.access_token) && user?.expired !== true
}

function requireToken(user: User, profileIdentity: string): AuthTokenSet {
  if (!isUsable(user)) {
    throw new Error(`[EndgeAuth] OIDC returned no usable session: ${profileIdentity}`)
  }
  return toTokenSet(user)
}

function toTokenSet(user: User): AuthTokenSet {
  return {
    accessToken: user.access_token,
    accessExpiresAt: user.expires_at == null ? null : user.expires_at * 1000,
    ...(user.refresh_token ? { refreshToken: user.refresh_token } : {}),
    ...(user.id_token ? { idToken: user.id_token } : {}),
    ...(user.session_state ? { sessionState: user.session_state } : {}),
    headers: { Authorization: `Bearer ${user.access_token}` },
  }
}

/** @deprecated Используйте OidcBrowserSession_Adapter. */
export { OidcBrowserSession_Adapter as OidcBrowserSession_Service }
