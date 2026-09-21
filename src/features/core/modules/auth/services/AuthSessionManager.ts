import type {
  AuthEnsureOptions,
  AuthProfileSchema,
  AuthResolvedSession,
  AuthSessionSource,
  AuthTokenSet,
  EndgeAuthContext,
} from '@/features/core/modules/auth/domain/types/auth-profile.types'
import type { AuthSessionState } from '@/features/core/modules/auth/domain/types/auth-runtime.types'

import type { AuthAdapterRegistry } from '@/features/core/modules/auth/services/AuthAdapterRegistry'
import type { AuthProfileRegistry } from '@/features/core/modules/auth/services/AuthProfileRegistry'
import type { AuthSessionStore } from '@/features/core/modules/auth/services/AuthSessionStore'
import { createEndgeAuthContext, decodeJwtClaims } from '@/features/core/modules/auth/services/auth-context'

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
  private readonly _sessionVersions = new Map<string, symbol>()
  private readonly _loggingOut = new Set<string>()
  private _generation = 0
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

  /** Runtime-профиль идентификации по умолчанию. */
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
    this._invalidateSession(profile.identity)
    this._loggingOut.delete(profile.identity)
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
    const isCurrent = this._sessionGuard(profile.identity)
    const token = await this.ensureProfile(profile)
    if (!token || !isCurrent()) {
      return null
    }
    const state = this._states.get(profile.identity)
    if (state?.userInfo) {
      return state.userInfo
    }
    const source = this._sources.get(profile.identity)
    if (source?.loadUserInfo) {
      const userInfo = await source.loadUserInfo()
      if (!isCurrent() || this._states.get(profile.identity)?.token !== token) {
        return null
      }
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
    if (!isCurrent() || this._states.get(profile.identity)?.token !== token) {
      return null
    }
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
    this._invalidateSession(profile.identity)
    const isCurrent = this._sessionGuard(profile.identity)
    this._loggingOut.add(profile.identity)
    this._clearState(profile)
    try {
      if (source) {
        await source.logout?.()
      }
      else if (state) {
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
      if (isCurrent()) {
        this._loggingOut.delete(profile.identity)
      }
    }
  }

  /** Гарантирует session указанного profile, не меняя default profile. */
  public async ensureProfile(profileInput: AuthProfileSchema, options: AuthEnsureOptions = {}): Promise<AuthTokenSet | null> {
    const profile = this._profiles.requireActive(profileInput)
    if (this._loggingOut.has(profile.identity)) {
      return null
    }
    const source = this._sources.get(profile.identity)
    if (source) {
      return this._singleFlight(profile, async () => {
        const token = await source.resolveToken({
          forceRefresh: options.forceRefresh === true,
          minValiditySeconds: Math.ceil(this._refreshSkewMs(profile) / 1000),
        })
        if (!token || !this._isSessionUsable(token)) {
          return null
        }
        return token
      }, false)
    }
    if (profile.adapterId === 'bearer' || profile.adapterId === 'basic') {
      return this._singleFlight(profile, () => this._authenticate(profile))
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
      return this._singleFlight(profile, async (isCurrent) => {
        try {
          const token = await adapter.refresh!({
            ...this._profiles.createAdapterContext(profile),
            token: state!.token,
          })
          return token
        }
        catch (error) {
          if (!isCurrent()) {
            return null
          }
          if (isInvalidGrant(error)) {
            this._clearState(profile)
            return this._authenticate(profile)
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
    return this._singleFlight(profile, () => this._authenticate(profile))
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
    this._generation += 1
    this._sessionVersions.clear()
    this._loggingOut.clear()
    this._states.clear()
    this._operations.clear()
    this._sources.clear()
    this._defaultProfile = null
    this._store.resetRuntime()
    this._dependencies.onSessionChange()
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
    profile: AuthProfileSchema,
    operation: (isCurrent: () => boolean) => Promise<AuthTokenSet | null>,
    persist = true,
  ): Promise<AuthTokenSet | null> {
    const profileIdentity = profile.identity
    const existing = this._operations.get(profileIdentity)
    if (existing) {
      return existing
    }
    const isCurrent = this._sessionGuard(profileIdentity)
    const promise = Promise.resolve().then(async () => {
      if (!isCurrent()) {
        return null
      }
      const token = await operation(isCurrent)
      if (!isCurrent()) {
        return null
      }
      if (token) {
        this._setState(profile, token, persist)
      }
      else { this._clearState(profile) }
      return token
    }).catch((error) => {
      if (!isCurrent()) {
        return null
      }
      throw error
    }).finally(() => {
      if (this._operations.get(profileIdentity) === promise) {
        this._operations.delete(profileIdentity)
      }
    })
    this._operations.set(profileIdentity, promise)
    return promise
  }

  /** Отсоединяет старую operation до изменения session owner. */
  private _invalidateSession(identity: string): void {
    this._sessionVersions.set(identity, Symbol(identity))
    this._operations.delete(identity)
  }

  /** Поздний ответ не должен менять новую сессию или другой workspace. */
  private _sessionGuard(identity: string): () => boolean {
    const generation = this._generation
    const version = this._sessionVersions.get(identity)
    const workspace = this._dependencies.getWorkspaceIdentity()
    return () => generation === this._generation
      && version === this._sessionVersions.get(identity)
      && workspace === this._dependencies.getWorkspaceIdentity()
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
