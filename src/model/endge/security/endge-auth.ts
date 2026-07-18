import type {
  EndgeTokenMode,
  GetAccessTokenOpts,
  StoredAuthToken,
} from '@/domain/types/auth/auth.types'
import type { EndgeAuthContext } from '@/domain/types/auth/auth-profile.types'
import type { DiagnosticsAttributes } from '@/domain/types/diagnostics'
import type { AxiosInstance } from 'axios'

import axios from 'axios'
import { isAfter, subMilliseconds } from 'date-fns'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { EndgeAuthProfiles } from '@/model/endge/security/endge-auth-profiles'
import {
  KeycloakAuthClient,
  mapTokenResponseToStored,
} from '@/model/services/auth/KeycloakAuthClient'
import { createEndgeAuthContext } from '@/model/services/auth/auth-context'
import { Endge } from '@/model/endge/kernel/endge'

type StringRecord = Record<string, string>
type KeycloakProvider = 'keycloak_manual' | 'keycloak_form'
type EndgeAuthProfileConfig = {
  profileIdentity: string
  provider: KeycloakProvider
  KeycloakBaseUrl: string
  storageKey: string
  clientId: string
  scope: string
  refreshSkewMs: number
  tokenPath?: string
  logoutPath?: string
  login?: string
  password?: string
}

function isKeycloakProvider(
  p: string | undefined,
): p is KeycloakProvider {
  return p === 'keycloak_manual' || p === 'keycloak_form'
}

/** Модуль legacy Keycloak-аутентификации и управления token lifecycle. */
export class EndgeAuth extends EndgeModule {
  /** Profile/adapters service, owned by the auth module. */
  public readonly profiles = new EndgeAuthProfiles()

  private auth: EndgeAuthProfileConfig | null = null
  private client: KeycloakAuthClient | null = null

  /** Единственный axios инстанс для всего модуля */
  private readonly http: AxiosInstance = axios.create({
    headers: { 'Content-Type': 'application/json' },
  })

  private accessToken: string = ''
  private refreshToken: string = ''
  private idToken: string = ''
  private sessionState: string = ''
  private accessExpiresAt: Date | null = null
  private refreshExpiresAt: Date | null = null
  private backgroundInterval: ReturnType<typeof setInterval> | null = null

  private initPromise: Promise<void> | null = null
  private isInitialized: boolean = false

  // ---------------------------------------------------------------------------
  // Single-flight auto-login для защиты от параллельных запросов.
  // ---------------------------------------------------------------------------
  private loginPromise: Promise<StoredAuthToken> | null = null

  // ---------------------------------------------------------------------------
  // Данные пользователя
  // ---------------------------------------------------------------------------
  private _userInfo: any = null
  private _unregisterDiagnosticsContext: (() => void) | null = null

  /**
   * Создает auth-модуль с изолированным axios instance.
   */
  public constructor() {
    super()
  }

  /** Подключает безопасный auth context к общему diagnostics enrichment pipeline. */
  public override setup(): void {
    this._unregisterDiagnosticsContext?.()
    this._unregisterDiagnosticsContext = Endge.diagnostics.registerContextProvider(
      'auth',
      () => this._getDiagnosticsAttributes(),
    )
  }

  /**
   * Возвращает axios instance, который автоматически использует Authorization header.
   */
  public get axios(): AxiosInstance {
    return this.http
  }

  /**
   * Возвращает текущий access token.
   */
  public get token(): string {
    return this.accessToken
  }

  /**
   * Возвращает активный auth-provider.
   */
  public get provider(): 'keycloak_manual' | 'keycloak_form' {
    if (!this.auth) { return 'keycloak_form' }
    return this.auth.provider
  }

  /**
   * Показывает, есть ли действующий access token.
   */
  public get isAuthenticated(): boolean {
    if (!this.accessToken || !this.accessExpiresAt) { return false }
    return !isAfter(new Date(), this.accessExpiresAt)
  }

  /**
   * Возвращает загруженный userinfo payload.
   */
  public get userInfo(): any {
    return this._userInfo
  }

  /** Возвращает минимальный синхронный actor/session snapshot без tokens и полного claims. */
  public get context(): EndgeAuthContext {
    return createEndgeAuthContext({
      authenticated: this.isAuthenticated,
      accessToken: this.accessToken,
      idToken: this.idToken,
      sessionState: this.sessionState,
      profileIdentity: this.auth?.profileIdentity,
      userInfo: this._userInfo,
    })
  }

  // ---------------------------------------------------------------------------
  // Инициализация
  // ---------------------------------------------------------------------------

  /**
   * Инициализирует auth-конфигурацию из профиля авторизации и восстанавливает токены из storage.
   */
  public async init(): Promise<void> {
    await this.ensureInit()
    // Временно отключено: сервис авторизации не работает
    // после инициализации из localStorage пробуем подтянуть userinfo
    // try {
    //   await this.loadUserInfo()
    // }
    // catch {
    //   // если не удалось - просто продолжаем без userinfo
    // }
  }

  /**
   * Гарантирует Init.
   */
  private async ensureInit(): Promise<void> {
    if (this.isInitialized) { return }
    if (this.initPromise) { return await this.initPromise }

    this.initPromise = this.initOnce()
    try {
      await this.initPromise
      this.isInitialized = true
    }
    finally {
      this.initPromise = null
    }
  }

  /**
   * Внутренний helper модуля: init Once.
   */
  private async initOnce(): Promise<void> {
    const auth: EndgeAuthProfileConfig | undefined = this.getAuthFromProfile()

    if (!auth) { throw new Error('Профиль авторизации Keycloak не задан') }

    if (!isKeycloakProvider(auth.provider)) { throw new Error(`Неподдерживаемый provider: ${String(auth.provider)}`) }

    this.auth = auth

    const tokenPath: string = auth.tokenPath ?? '/token'
    const logoutPath: string = auth.logoutPath ?? '/logout'
    const endpoint
      = Endge.workspace.variables.resolve(auth.KeycloakBaseUrl) || auth.KeycloakBaseUrl
    this.client = new KeycloakAuthClient(endpoint, tokenPath, logoutPath)

    await this.loadFromStorage()
    this.startBackgroundRefresh()
  }

  /** Собирает auth config из первого активного Keycloak profile. */
  private getAuthFromProfile(): EndgeAuthProfileConfig | undefined {
    const profile = Endge.domain.getAuthProfiles()
      .find(item => item.active !== false && (item.adapterId === 'keycloak_manual' || item.adapterId === 'keycloak_form'))
    if (!profile)
      return undefined
    const config = profile.config ?? {}
    const provider = String(profile.adapterId)
    if (!isKeycloakProvider(provider))
      return undefined

    return {
      profileIdentity: profile.identity,
      provider,
      KeycloakBaseUrl: String(config.KeycloakBaseUrl ?? ''),
      storageKey: String(config.storageKey ?? `endge.auth.${profile.identity}`),
      clientId: String(config.clientId ?? ''),
      scope: String(config.scope ?? ''),
      refreshSkewMs: Number(config.refreshSkewMs ?? 30_000),
      tokenPath: config.tokenPath == null ? undefined : String(config.tokenPath),
      logoutPath: config.logoutPath == null ? undefined : String(config.logoutPath),
      login: config.login == null ? undefined : String(config.login),
      password: config.password == null ? undefined : String(config.password),
    }
  }

  // ---------------------------------------------------------------------------
  // Публичный API
  // ---------------------------------------------------------------------------

  /**
   * Выполняет ручной login с credentials из auth profile.
   */
  public async login(): Promise<StoredAuthToken> {
    await this.ensureInit()

    const auth: EndgeAuthProfileConfig = this.requireAuth()
    if (auth.provider !== 'keycloak_manual') { throw new Error('login() доступен только для провайдера keycloak_manual') }

    const username: string | undefined = auth.login
    const password: string | undefined = auth.password

    if (!username || !password) {
      throw new Error(
        'keycloak_manual требует заполненных login и password в профиле авторизации',
      )
    }

    return await this.loginWithCredentials(username, password)
  }

  /**
   * Выполняет form login с credentials из UI.
   */
  public async loginForm(
    username: string,
    password: string,
  ): Promise<StoredAuthToken> {
    await this.ensureInit()

    const auth: EndgeAuthProfileConfig = this.requireAuth()
    if (auth.provider !== 'keycloak_form') {
      throw new Error(
        'loginForm() доступен только для провайдера keycloak_form',
      )
    }

    const u: string = username.trim()
    const p: string = password.trim()
    if (!u || !p) { throw new Error('username/password are required') }

    return await this.loginWithCredentials(u, p)
  }

  /**
   * Обновляет access token через refresh token.
   */
  public async refresh(): Promise<boolean> {
    await this.ensureInit()

    const auth: EndgeAuthProfileConfig = this.requireAuth()
    const client: KeycloakAuthClient = this.requireClient()

    if (!this.refreshToken) { return false }
    if (!this.refreshExpiresAt) { return false }
    if (isAfter(new Date(), this.refreshExpiresAt)) { return false }

    const payload: StringRecord = {
      client_id: auth.clientId,
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
    }

    const data = await client.refreshGrant(payload)
    const stored: StoredAuthToken = {
      ...mapTokenResponseToStored(data),
      ...(data.id_token || this.idToken ? { id_token: data.id_token ?? this.idToken } : {}),
      ...(data.session_state || this.sessionState ? { session_state: data.session_state ?? this.sessionState } : {}),
    }

    this.saveToStorage(stored)
    await this.loadFromStorage()

    return true
  }

  /**
   * Проверяет срок access token и обновляет его при приближении истечения.
   */
  public async checkAccessToken(): Promise<void> {
    await this.ensureInit()

    const auth: EndgeAuthProfileConfig = this.requireAuth()
    if (!this.accessExpiresAt) { return }

    const now: Date = new Date()
    const refreshAt: Date = subMilliseconds(
      this.accessExpiresAt,
      auth.refreshSkewMs,
    )

    if (!isAfter(now, refreshAt)) { return }

    await this.refresh()
  }

  /**
   * Выполняет logout, очищает storage, локальные токены и Authorization header.
   */
  public async logout(): Promise<void> {
    await this.ensureInit()

    const auth: EndgeAuthProfileConfig = this.requireAuth()
    const client: KeycloakAuthClient = this.requireClient()

    try {
      if (this.refreshToken) {
        const payload: StringRecord = {
          client_id: auth.clientId,
          refresh_token: this.refreshToken,
        }
        await client.logout(payload)
      }
    }
    catch {
      // noop
    }

    localStorage.removeItem(auth.storageKey)

    this.accessToken = ''
    this.refreshToken = ''
    this.idToken = ''
    this.sessionState = ''
    this.accessExpiresAt = null
    this.refreshExpiresAt = null
    this._userInfo = null

    this.applyAuthHeader('')
    this.notify()
  }

  /**
   * Останавливает фоновую проверку и обновление access token.
   */
  public stopBackgroundRefresh(): void {
    if (!this.backgroundInterval) { return }
    clearInterval(this.backgroundInterval)
    this.backgroundInterval = null
  }

  // ---------------------------------------------------------------------------
  // Внутренние операции
  // ---------------------------------------------------------------------------

  /**
   * Внутренний helper модуля: require Auth.
   */
  private requireAuth(): EndgeAuthProfileConfig {
    if (!this.auth) { throw new Error('EndgeAuth не инициализирован: auth отсутствует') }
    return this.auth
  }

  /**
   * Внутренний helper модуля: require Service.
   */
  private requireClient(): KeycloakAuthClient {
    if (!this.client) { throw new Error('EndgeAuth не инициализирован: auth client отсутствует') }
    return this.client
  }

  /**
   * Внутренний helper модуля: login With Credentials.
   */
  private async loginWithCredentials(
    username: string,
    password: string,
  ): Promise<StoredAuthToken> {
    const auth: EndgeAuthProfileConfig = this.requireAuth()
    const client: KeycloakAuthClient = this.requireClient()

    const payload: StringRecord = {
      username,
      password,
      client_id: auth.clientId,
      grant_type: 'password',
      scope: auth.scope,
    }

    const data = await client.passwordGrant(payload)
    const stored: StoredAuthToken = mapTokenResponseToStored(data)

    this.saveToStorage(stored)
    await this.loadFromStorage()

    // Временно отключено: сервис авторизации не работает
    // сразу после успешной авторизации подтягиваем userinfo
    // try {
    //   await this.loadUserInfo()
    // }
    // catch {
    //   // если не удалось - авторизация всё равно считается успешной
    // }

    return stored
  }

  /**
   * Внутренний helper модуля: save To Storage.
   */
  private saveToStorage(data: StoredAuthToken): void {
    const auth: EndgeAuthProfileConfig = this.requireAuth()
    localStorage.setItem(auth.storageKey, JSON.stringify(data))
  }

  /**
   * Внутренний helper модуля: load From Storage.
   */
  private async loadFromStorage(): Promise<void> {
    const auth: EndgeAuthProfileConfig = this.requireAuth()

    this.accessToken = ''
    this.refreshToken = ''
    this.idToken = ''
    this.sessionState = ''
    this.accessExpiresAt = null
    this.refreshExpiresAt = null
    this._userInfo = null

    const raw: string | null = localStorage.getItem(auth.storageKey)
    if (!raw) {
      this.applyAuthHeader('')
      return
    }

    const parsed: unknown = JSON.parse(raw)
    if (!this.isStoredAuthToken(parsed)) {
      this.applyAuthHeader('')
      return
    }

    this.accessToken = parsed.access_token
    this.refreshToken = parsed.refresh_token ?? ''
    this.idToken = parsed.id_token ?? ''
    this.sessionState = parsed.session_state ?? ''
    this.accessExpiresAt = new Date(parsed.access_expires)
    this.refreshExpiresAt = parsed.refresh_expires
      ? new Date(parsed.refresh_expires)
      : null

    this.applyAuthHeader(this.accessToken)
    this.notify()
  }

  /**
   * Применяет Auth Header.
   */
  private applyAuthHeader(accessToken: string): void {
    if (accessToken) { this.http.defaults.headers.common.Authorization = `Bearer ${accessToken}` }
    else { delete this.http.defaults.headers.common.Authorization }
  }

  /**
   * Проверяет is Stored Auth Token.
   */
  private isStoredAuthToken(v: unknown): v is StoredAuthToken {
    if (typeof v !== 'object' || v === null) { return false }
    const r: Record<string, unknown> = v as Record<string, unknown>
    return (
      typeof r.access_token === 'string' && typeof r.access_expires === 'string'
    )
  }

  /**
   * Запускает Background Refresh.
   */
  private startBackgroundRefresh(): void {
    if (this.backgroundInterval) { return }
    this.backgroundInterval = setInterval((): void => {
      void this.checkAccessToken()
    }, 60_000)
  }

  /**
   * Полностью сбрасывает auth-состояние модуля.
   */
  public reset(): void {
    // остановка фонового refresh
    if (this.backgroundInterval) {
      clearInterval(this.backgroundInterval)
      this.backgroundInterval = null
    }

    // очистка local state
    this.accessToken = ''
    this.refreshToken = ''
    this.idToken = ''
    this.sessionState = ''
    this.accessExpiresAt = null
    this.refreshExpiresAt = null
    this._userInfo = null

    // очистка storage
    if (this.auth?.storageKey) {
      localStorage.removeItem(this.auth.storageKey)
    }

    // очистка axios
    this.applyAuthHeader('')

    // сброс зависимостей
    this.auth = null
    this.client = null

    // сброс init-состояния
    this.isInitialized = false
    this.initPromise = null

    // NEW: reset single-flight
    this.loginPromise = null

    this.profiles.reset()

    // уведомление подписчиков
    this.notify()
  }

  /**
   * Гарантирует Authenticated.
   */
  private async ensureAuthenticated(): Promise<void> {
    await this.ensureInit()

    if (this.isAuthenticated) { return }

    // 1) если есть refresh_token - пробуем refresh
    if (this.refreshToken) {
      const refreshed: boolean = await this.refresh()
      if (refreshed && this.isAuthenticated) { return }
    }

    // 2) если provider manual - логинимся сами (single-flight)
    const auth: EndgeAuthProfileConfig = this.requireAuth()
    if (auth.provider === 'keycloak_manual') {
      if (!this.loginPromise) {
        this.loginPromise = this.login().finally(() => {
          this.loginPromise = null
        })
      }
      await this.loginPromise
    }
    // keycloak_form: логин делает UI
  }

  /**
   * Возвращает token согласно режиму: none, manual или inherit.
   */
  public async getAccessToken(
    opts: GetAccessTokenOpts = { mode: 'inherit' },
  ): Promise<string | undefined> {
    const mode: EndgeTokenMode = opts.mode ?? 'inherit'

    if (mode === 'none') {
      return undefined
    }

    if (mode === 'manual') {
      const raw: string = String(opts.manualToken ?? '').trim()
      const resolved: string = (Endge.workspace.variables.resolve(raw) ?? raw).trim()
      return resolved || undefined
    }

    // inherit
    await this.ensureAuthenticated()
    await this.checkAccessToken()

    const t: string = (this.accessToken ?? '').trim()
    return t || undefined
  }

  /**
   * Явная подгрузка userinfo.
   * Используем уже инициализированный сервис + axios с Authorization.
   */
  public async loadUserInfo(): Promise<void> {
    await this.ensureInit()

    const client: KeycloakAuthClient = this.requireClient()
    try {
      const data = await client.getUserInfo(this.http)
      this._userInfo = data
      this.notify()
    }
    catch (error) {
      console.error('Failed to load user info:', error)
      this._userInfo = null
      throw error
    }
  }

  /** Преобразует auth context в OTel-aligned attributes для каждого нового diagnostics record. */
  private _getDiagnosticsAttributes(): DiagnosticsAttributes {
    const context = this.context
    if (!context.authenticated)
      return {}

    return {
      ...(context.subject ? { 'user.id': context.subject } : {}),
      ...(context.sessionId ? { 'session.id': context.sessionId } : {}),
      ...(context.profileIdentity ? { 'endge.auth.profile.id': context.profileIdentity } : {}),
    }
  }
}
