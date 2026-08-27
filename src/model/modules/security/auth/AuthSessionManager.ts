import type {
  AuthEnsureOptions,
  AuthProfileSchema,
  AuthResolvedSession,
  AuthSessionSource,
  AuthTokenSet,
  EndgeAuthContext,
} from '@/domain/types/auth/auth-profile.types'
import type { AuthSessionState } from '@/domain/types/auth/auth-runtime.types'

import type { AuthAdapterRegistry } from '@/model/modules/security/auth/AuthAdapterRegistry'
import type { AuthProfileRegistry } from '@/model/modules/security/auth/AuthProfileRegistry'
import type { AuthSessionStore } from '@/model/modules/security/auth/AuthSessionStore'
import { createEndgeAuthContext, decodeJwtClaims } from '@/model/services/auth/auth-context'

interface AuthSessionManagerDependencies {
  getWorkspaceIdentity: () => string
  onSessionChange: () => void
  now?: () => number
}

/** Владеет изолированными sessions runtime auth profiles. */
export class AuthSessionManager {
  private readonly _states = new Map<string, AuthSessionState>()
  private readonly _operations = new Map<string, Promise<AuthTokenSet | null>>()
  private readonly _sources = new Map<string, AuthSessionSource>()
  private readonly _now: () => number
  private _defaultProfile: AuthProfileSchema | null = null

  public constructor(
    private readonly _profiles: AuthProfileRegistry,
    private readonly _adapters: AuthAdapterRegistry,
    private readonly _store: AuthSessionStore,
    private readonly _dependencies: AuthSessionManagerDependencies,
  ) {
    this._now = _dependencies.now ?? (() => Date.now())
  }

  /** Identity default runtime profile. */
  public get profileIdentity(): string | null {
    return this._defaultProfile?.identity ?? null
  }

  /** Показывает наличие действующей session default runtime profile. */
  public get isAuthenticated(): boolean {
    const state = this._defaultState()
    return Boolean(state && this._isSessionUsable(state.token))
  }

  /** Безопасный actor/session context без tokens. */
  public get context(): EndgeAuthContext {
    const state = this._defaultState()
    if (!state || !this._defaultProfile || !this._isSessionUsable(state.token)) {
      return { authenticated: false }
    }
    return createEndgeAuthContext({
      authenticated: true,
      accessToken: state.token.accessToken,
      idToken: state.token.idToken,
      sessionState: state.token.sessionState,
      profileIdentity: this._defaultProfile.identity,
      userInfo: state.userInfo,
    })
  }

  /** Claims default profile session только для presentation, не для authorization decisions. */
  public get claims(): Record<string, unknown> {
    const token = this._defaultState()?.token
    return decodeJwtClaims(token?.idToken) ?? decodeJwtClaims(token?.accessToken) ?? {}
  }

  /** Загруженный OIDC userinfo default profile session. */
  public get userInfo(): Record<string, unknown> | null {
    return this._defaultState()?.userInfo ?? null
  }

  /** Выбирает default runtime profile и восстанавливает его snapshot. */
  public configureDefault(profile: AuthProfileSchema | null): void {
    this._defaultProfile = profile
    if (!profile) {
      this._dependencies.onSessionChange()
      return
    }
    const snapshot = this._store.read(this._workspaceIdentity(), profile)
    if (!snapshot) {
      this._dependencies.onSessionChange()
      return
    }
    if (this._isRefreshExpired(snapshot.token)) {
      this._store.remove(this._workspaceIdentity(), profile.identity)
      this._dependencies.onSessionChange()
      return
    }
    this._states.set(profile.identity, { token: snapshot.token, userInfo: null })
    this._dependencies.onSessionChange()
  }

  /** Подключает host-owned session source и запрещает смешивание с persisted snapshot profile. */
  public connect(profileIdentity: string, source: AuthSessionSource): void {
    const profile = this._profiles.requireActive(profileIdentity)
    this._sources.set(profile.identity, source)
    this._states.delete(profile.identity)
    this._operations.delete(profile.identity)
    this._store.remove(this._workspaceIdentity(), profile.identity)
    if (profile.identity === this._defaultProfile?.identity) {
      this._dependencies.onSessionChange()
    }
  }

  /** Гарантирует действующую session default runtime profile. */
  public async ensureValid(options: AuthEnsureOptions = {}): Promise<boolean> {
    const profile = this._defaultProfile
    if (!profile) {
      return false
    }
    const token = await this.ensureProfile(profile, options)
    return Boolean(token && this._isSessionUsable(token))
  }

  /** Загружает userinfo для session default runtime profile. */
  public async ensureUserInfo(): Promise<Record<string, unknown> | null> {
    const profile = this._defaultProfile
    if (!profile) {
      return null
    }
    const token = await this.ensureProfile(profile)
    if (!token) {
      return null
    }
    const state = this._states.get(profile.identity)
    if (state?.userInfo) {
      return state.userInfo
    }
    const source = this._sources.get(profile.identity)
    if (source?.loadUserInfo) {
      const userInfo = await source.loadUserInfo()
      this._states.set(profile.identity, { token, userInfo })
      this._dependencies.onSessionChange()
      return userInfo
    }
    const adapter = this._adapters.require(profile)
    if (!adapter.loadUserInfo) {
      return null
    }
    const userInfo = await adapter.loadUserInfo({
      ...this._profiles.createAdapterContext(profile),
      token,
    })
    this._states.set(profile.identity, { token, userInfo })
    this._dependencies.onSessionChange()
    return userInfo
  }

  /** Завершает session default runtime profile и всегда очищает local snapshot. */
  public async logout(): Promise<void> {
    const profile = this._defaultProfile
    if (!profile) {
      return
    }
    const state = this._states.get(profile.identity)
    const source = this._sources.get(profile.identity)
    if (source) {
      this._clearState(profile)
      await source.logout?.()
      return
    }
    try {
      if (state) {
        await this._adapters.require(profile).logout?.({
          ...this._profiles.createAdapterContext(profile),
          token: state.token,
        })
      }
    }
    catch {
      // Серверный logout не блокирует обязательную локальную очистку.
    }
    finally {
      this._clearState(profile)
    }
  }

  /** Гарантирует session указанного profile, не меняя default profile. */
  public async ensureProfile(profileInput: AuthProfileSchema, options: AuthEnsureOptions = {}): Promise<AuthTokenSet | null> {
    const profile = this._profiles.requireActive(profileInput)
    const source = this._sources.get(profile.identity)
    if (source) {
      return this._singleFlight(profile.identity, async () => {
        const token = await source.resolveToken({
          forceRefresh: options.forceRefresh === true,
          minValiditySeconds: Math.ceil(this._refreshSkewMs(profile) / 1000),
        })
        if (!token || !this._isSessionUsable(token)) {
          this._clearState(profile)
          return null
        }
        this._setState(profile, token, false)
        return token
      })
    }
    if (profile.adapterId === 'bearer' || profile.adapterId === 'basic') {
      return this._singleFlight(profile.identity, async () => {
        const token = await this._authenticate(profile)
        this._setState(profile, token)
        return token
      })
    }

    let state = this._states.get(profile.identity)
    if (!state) {
      const snapshot = this._store.read(this._workspaceIdentity(), profile)
      if (snapshot && !this._isRefreshExpired(snapshot.token)) {
        state = { token: snapshot.token, userInfo: null }
        this._states.set(profile.identity, state)
      }
    }

    if (!options.forceRefresh && state && this._isAccessTokenFresh(profile, state.token)) {
      return state.token
    }

    const adapter = this._adapters.require(profile)
    if (state?.token.refreshToken && !this._isRefreshExpired(state.token) && adapter.refresh) {
      return this._singleFlight(profile.identity, async () => {
        try {
          const token = await adapter.refresh!({
            ...this._profiles.createAdapterContext(profile),
            token: state!.token,
          })
          this._setState(profile, token)
          return token
        }
        catch (error) {
          if (isInvalidGrant(error)) {
            this._clearState(profile)
            return this._authenticateWhenAllowed(profile)
          }
          if (this._isAccessTokenUsable(state!.token)) {
            return state!.token
          }
          throw error
        }
      })
    }

    if (state && this._isRefreshExpired(state.token)) {
      this._clearState(profile)
    }
    return this._singleFlight(profile.identity, () => this._authenticateWhenAllowed(profile))
  }

  /** Преобразует token set в transport-neutral request session. */
  public toResolvedSession(profile: AuthProfileSchema, token: AuthTokenSet): AuthResolvedSession {
    const context = createEndgeAuthContext({
      authenticated: this._isSessionUsable(token),
      accessToken: token.accessToken,
      idToken: token.idToken,
      sessionState: token.sessionState,
      profileIdentity: profile.identity,
      userInfo: this._states.get(profile.identity)?.userInfo,
    })
    return {
      profileIdentity: profile.identity,
      accessToken: token.accessToken,
      headers: token.headers ?? (token.accessToken ? { Authorization: `Bearer ${token.accessToken}` } : {}),
      expiresAt: token.accessExpiresAt,
      ...(context.subject ? { subject: context.subject } : {}),
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    }
  }

  /** Сбрасывает runtime state, сохраняя local/sessionStorage snapshots. */
  public resetRuntime(): void {
    this._states.clear()
    this._operations.clear()
    this._sources.clear()
    this._defaultProfile = null
    this._store.resetRuntime()
    this._dependencies.onSessionChange()
  }

  private async _authenticateWhenAllowed(profile: AuthProfileSchema): Promise<AuthTokenSet | null> {
    const token = await this._authenticate(profile)
    this._setState(profile, token)
    return token
  }

  private async _authenticate(profile: AuthProfileSchema): Promise<AuthTokenSet> {
    const adapter = this._adapters.require(profile)
    return adapter.authenticate(this._profiles.createAdapterContext(profile))
  }

  private _setState(profile: AuthProfileSchema, token: AuthTokenSet, persist: boolean = true): void {
    const previous = this._states.get(profile.identity)
    this._states.set(profile.identity, { token, userInfo: previous?.userInfo ?? null })
    if (persist) {
      this._store.write(this._workspaceIdentity(), profile, {
        version: 1,
        profileIdentity: profile.identity,
        adapterId: profile.adapterId,
        token,
        updatedAt: new Date(this._now()).toISOString(),
      })
    }
    if (profile.identity === this._defaultProfile?.identity) {
      this._dependencies.onSessionChange()
    }
  }

  private _clearState(profile: AuthProfileSchema): void {
    this._states.delete(profile.identity)
    this._store.remove(this._workspaceIdentity(), profile.identity)
    if (profile.identity === this._defaultProfile?.identity) {
      this._dependencies.onSessionChange()
    }
  }

  private _defaultState(): AuthSessionState | null {
    return this._defaultProfile
      ? this._states.get(this._defaultProfile.identity) ?? null
      : null
  }

  private _isAccessTokenUsable(token: AuthTokenSet): boolean {
    return Boolean(token.accessToken)
      && (token.accessExpiresAt == null || token.accessExpiresAt > this._now())
  }

  private _isSessionUsable(token: AuthTokenSet): boolean {
    return this._isAccessTokenUsable(token) || Object.keys(token.headers ?? {}).length > 0
  }

  private _isAccessTokenFresh(profile: AuthProfileSchema, token: AuthTokenSet): boolean {
    if (!token.accessToken) {
      return Object.keys(token.headers ?? {}).length > 0
    }
    if (token.accessExpiresAt == null) {
      return true
    }
    const skew = this._refreshSkewMs(profile)
    return token.accessExpiresAt - Math.max(0, skew) > this._now()
  }

  private _refreshSkewMs(profile: AuthProfileSchema): number {
    return profile.adapterId === 'oidc'
      || profile.adapterId === 'oauth2-client-credentials'
      || profile.adapterId === 'oauth2-password'
      ? 30_000
      : 0
  }

  private _isRefreshExpired(token: AuthTokenSet): boolean {
    return token.refreshExpiresAt != null && token.refreshExpiresAt <= this._now()
  }

  private _workspaceIdentity(): string {
    const identity = String(this._dependencies.getWorkspaceIdentity() ?? '').trim()
    if (!identity) {
      throw new Error('[EndgeAuth] Workspace identity is unavailable')
    }
    return identity
  }

  private async _singleFlight(
    profileIdentity: string,
    operation: () => Promise<AuthTokenSet | null>,
  ): Promise<AuthTokenSet | null> {
    const existing = this._operations.get(profileIdentity)
    if (existing) {
      return existing
    }
    const promise = operation().finally(() => {
      if (this._operations.get(profileIdentity) === promise) {
        this._operations.delete(profileIdentity)
      }
    })
    this._operations.set(profileIdentity, promise)
    return promise
  }
}

function isInvalidGrant(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const record = error as Record<string, any>
  return record.response?.data?.error === 'invalid_grant'
    || record.code === 'invalid_grant'
    || record.error === 'invalid_grant'
}
