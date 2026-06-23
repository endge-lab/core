import type {
  EndgeTokenMode,
  GetAccessTokenOpts,
  StoredAuthToken,
} from '@/domain/types/auth.types'
import type { SettingsAuthSchema } from '@/domain/types/settings.types'
import type { AxiosInstance } from 'axios'

import axios from 'axios'
import { isAfter, subMilliseconds } from 'date-fns'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import {
  KeycloakAuthService,
  mapTokenResponseToStored,
} from '@/domain/services/auth'
import { Endge } from '@/model/endge/endge'

type StringRecord = Record<string, string>
type KeycloakProvider = 'keycloak_manual' | 'keycloak_form'

function isKeycloakProvider(
  p: SettingsAuthSchema['provider'],
): p is KeycloakProvider {
  return p === 'keycloak_manual' || p === 'keycloak_form'
}

export class EndgeAuth extends EndgeModule {
  private auth: SettingsAuthSchema | null = null
  private service: KeycloakAuthService | null = null

  /** Единственный axios инстанс для всего модуля */
  private readonly http: AxiosInstance = axios.create({
    headers: { 'Content-Type': 'application/json' },
  })

  private accessToken: string = ''
  private refreshToken: string = ''
  private accessExpiresAt: Date | null = null
  private refreshExpiresAt: Date | null = null
  private backgroundInterval: ReturnType<typeof setInterval> | null = null

  private initPromise: Promise<void> | null = null
  private isInitialized: boolean = false

  // ---------------------------------------------------------------------------
  // NEW: single-flight auto-login (чтобы не спамить логином при параллельных вызовах)
  // ---------------------------------------------------------------------------
  private loginPromise: Promise<StoredAuthToken> | null = null

  // ---------------------------------------------------------------------------
  // USER INFO
  // ---------------------------------------------------------------------------
  private _userInfo: any = null

  public constructor() {
    super()
  }

  /** Axios, который уже умеет Authorization */
  public get axios(): AxiosInstance {
    return this.http
  }

  public get token(): string {
    return this.accessToken
  }

  public get provider(): 'keycloak_manual' | 'keycloak_form' {
    if (!this.auth) { return 'keycloak_form' }
    return this.auth.provider
  }

  public get isAuthenticated(): boolean {
    if (!this.accessToken || !this.accessExpiresAt) { return false }
    return !isAfter(new Date(), this.accessExpiresAt)
  }

  public get userInfo(): any {
    return this._userInfo
  }

  // ---------------------------------------------------------------------------
  // INIT
  // ---------------------------------------------------------------------------

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

  private async initOnce(): Promise<void> {
    const settings: any = Endge.domain.getSetting('general')
    const auth: SettingsAuthSchema | undefined = settings?.auth

    if (!auth) { throw new Error('Settings.general.auth отсутствует') }

    if (!isKeycloakProvider(auth.provider)) { throw new Error(`Неподдерживаемый provider: ${String(auth.provider)}`) }

    this.auth = auth

    const tokenPath: string = auth.tokenPath ?? '/token'
    const logoutPath: string = auth.logoutPath ?? '/logout'
    const endpoint
      = Endge.vars.resolve(auth.KeycloakBaseUrl) || auth.KeycloakBaseUrl
    this.service = new KeycloakAuthService(endpoint, tokenPath, logoutPath)

    await this.loadFromStorage()
    this.startBackgroundRefresh()
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  /**
   * Manual login: логин/пароль берём из settings
   */
  public async login(): Promise<StoredAuthToken> {
    await this.ensureInit()

    const auth: SettingsAuthSchema = this.requireAuth()
    if (auth.provider !== 'keycloak_manual') { throw new Error('login() доступен только для провайдера keycloak_manual') }

    const username: string | undefined = auth.login
    const password: string | undefined = auth.password

    if (!username || !password) {
      throw new Error(
        'keycloak_manual требует заполненных auth.login и auth.password в Settings',
      )
    }

    return await this.loginWithCredentials(username, password)
  }

  /**
   * Form login: логин/пароль приходят из UI
   */
  public async loginForm(
    username: string,
    password: string,
  ): Promise<StoredAuthToken> {
    await this.ensureInit()

    const auth: SettingsAuthSchema = this.requireAuth()
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

  public async refresh(): Promise<boolean> {
    await this.ensureInit()

    const auth: SettingsAuthSchema = this.requireAuth()
    const service: KeycloakAuthService = this.requireService()

    if (!this.refreshToken) { return false }
    if (!this.refreshExpiresAt) { return false }
    if (isAfter(new Date(), this.refreshExpiresAt)) { return false }

    const payload: StringRecord = {
      client_id: auth.clientId,
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
    }

    const data = await service.refreshGrant(payload)
    const stored: StoredAuthToken = mapTokenResponseToStored(data)

    this.saveToStorage(stored)
    await this.loadFromStorage()

    return true
  }

  public async checkAccessToken(): Promise<void> {
    await this.ensureInit()

    const auth: SettingsAuthSchema = this.requireAuth()
    if (!this.accessExpiresAt) { return }

    const now: Date = new Date()
    const refreshAt: Date = subMilliseconds(
      this.accessExpiresAt,
      auth.refreshSkewMs,
    )

    if (!isAfter(now, refreshAt)) { return }

    await this.refresh()
  }

  public async logout(): Promise<void> {
    await this.ensureInit()

    const auth: SettingsAuthSchema = this.requireAuth()
    const service: KeycloakAuthService = this.requireService()

    try {
      if (this.refreshToken) {
        const payload: StringRecord = {
          client_id: auth.clientId,
          refresh_token: this.refreshToken,
        }
        await service.logout(payload)
      }
    }
    catch {
      // noop
    }

    localStorage.removeItem(auth.storageKey)

    this.accessToken = ''
    this.refreshToken = ''
    this.accessExpiresAt = null
    this.refreshExpiresAt = null
    this._userInfo = null

    this.applyAuthHeader('')
    this.notify()
  }

  public stopBackgroundRefresh(): void {
    if (!this.backgroundInterval) { return }
    clearInterval(this.backgroundInterval)
    this.backgroundInterval = null
  }

  // ---------------------------------------------------------------------------
  // INTERNAL
  // ---------------------------------------------------------------------------

  private requireAuth(): SettingsAuthSchema {
    if (!this.auth) { throw new Error('AODBAuth не инициализирован: auth отсутствует') }
    return this.auth
  }

  private requireService(): KeycloakAuthService {
    if (!this.service) { throw new Error('AODBAuth не инициализирован: service отсутствует') }
    return this.service
  }

  private async loginWithCredentials(
    username: string,
    password: string,
  ): Promise<StoredAuthToken> {
    const auth: SettingsAuthSchema = this.requireAuth()
    const service: KeycloakAuthService = this.requireService()

    const payload: StringRecord = {
      username,
      password,
      client_id: auth.clientId,
      grant_type: 'password',
      scope: auth.scope,
    }

    const data = await service.passwordGrant(payload)
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

  private saveToStorage(data: StoredAuthToken): void {
    const auth: SettingsAuthSchema = this.requireAuth()
    localStorage.setItem(auth.storageKey, JSON.stringify(data))
  }

  private async loadFromStorage(): Promise<void> {
    const auth: SettingsAuthSchema = this.requireAuth()

    this.accessToken = ''
    this.refreshToken = ''
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
    this.accessExpiresAt = new Date(parsed.access_expires)
    this.refreshExpiresAt = parsed.refresh_expires
      ? new Date(parsed.refresh_expires)
      : null

    this.applyAuthHeader(this.accessToken)
    this.notify()
  }

  private applyAuthHeader(accessToken: string): void {
    if (accessToken) { this.http.defaults.headers.common.Authorization = `Bearer ${accessToken}` }
    else { delete this.http.defaults.headers.common.Authorization }
  }

  private isStoredAuthToken(v: unknown): v is StoredAuthToken {
    if (typeof v !== 'object' || v === null) { return false }
    const r: Record<string, unknown> = v as Record<string, unknown>
    return (
      typeof r.access_token === 'string' && typeof r.access_expires === 'string'
    )
  }

  private startBackgroundRefresh(): void {
    if (this.backgroundInterval) { return }
    this.backgroundInterval = setInterval((): void => {
      void this.checkAccessToken()
    }, 60_000)
  }

  public reset(): void {
    // остановка фонового refresh
    if (this.backgroundInterval) {
      clearInterval(this.backgroundInterval)
      this.backgroundInterval = null
    }

    // очистка local state
    this.accessToken = ''
    this.refreshToken = ''
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
    this.service = null

    // сброс init-состояния
    this.isInitialized = false
    this.initPromise = null

    // NEW: reset single-flight
    this.loginPromise = null

    // уведомление подписчиков
    this.notify()
  }

  private async ensureAuthenticated(): Promise<void> {
    await this.ensureInit()

    if (this.isAuthenticated) { return }

    // 1) если есть refresh_token - пробуем refresh
    if (this.refreshToken) {
      const refreshed: boolean = await this.refresh()
      if (refreshed && this.isAuthenticated) { return }
    }

    // 2) если provider manual - логинимся сами (single-flight)
    const auth: SettingsAuthSchema = this.requireAuth()
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

  public async getAccessToken(
    opts: GetAccessTokenOpts = { mode: 'inherit' },
  ): Promise<string | undefined> {
    const mode: EndgeTokenMode = opts.mode ?? 'inherit'

    if (mode === 'none') {
      return undefined
    }

    if (mode === 'manual') {
      const raw: string = String(opts.manualToken ?? '').trim()
      const resolved: string = (Endge.vars.resolve(raw) ?? raw).trim()
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

    const service: KeycloakAuthService = this.requireService()
    try {
      const data = await service.getUserInfo(this.http)
      this._userInfo = data
      this.notify()
    }
    catch (error) {
      console.error('Failed to load user info:', error)
      this._userInfo = null
      throw error
    }
  }
}
