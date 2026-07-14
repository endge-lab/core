import type { RAuthProfile } from '@/domain/entities/reflect/RAuthProfile'
import type {
  AuthProfileAdapter,
  AuthProfileSchema,
  AuthSession,
} from '@/domain/types/auth/auth-profile.types'
import type { RQueryAuth } from '@/domain/types/document/query.types'
import type { StoredAuthToken } from '@/domain/types/auth/auth.types'

import {
  KeycloakAuthClient,
  mapTokenResponseToStored,
} from '@/model/services/auth/KeycloakAuthClient'
import { Endge } from '@/model/endge/kernel/endge'

/** Service auth profiles, adapters и хранения полученных tokens. */
export class EndgeAuthProfiles {
  private adapters = new Map<string, AuthProfileAdapter>()
  private memoryTokens = new Map<string, StoredAuthToken>()

  /** Создаёт service с зарегистрированными built-in adapters. */
  public constructor() {
    this.reset()
  }

  /** Регистрирует auth adapter с необязательной заменой существующего. */
  public registerAdapter(adapter: AuthProfileAdapter, opts: { replace?: boolean } = {}): void {
    const id = String(adapter.id ?? '').trim()
    if (!id)
      throw new Error('[EndgeAuthProfiles.registerAdapter] adapter.id is required')
    if (this.adapters.has(id) && opts.replace !== true)
      throw new Error(`[EndgeAuthProfiles.registerAdapter] Adapter already registered: ${id}`)
    this.adapters.set(id, adapter)
  }

  /** Возвращает auth adapter по id. */
  public getAdapter(id: string): AuthProfileAdapter | null {
    return this.adapters.get(id) ?? null
  }

  /** Возвращает активный auth profile workspace по умолчанию. */
  public getDefaultProfile(): RAuthProfile | AuthProfileSchema | null {
    const profiles = Endge.domain.getAuthProfiles()
      .filter(profile => profile.active !== false && !profile.deletedAt)
    const defaultIdentity = Endge.workspace.isLoaded
      ? String(Endge.workspace.defaultAuthProfileIdentity ?? '').trim()
      : ''
    if (defaultIdentity)
      return profiles.find(profile => profile.identity === defaultIdentity) ?? null
    return null
  }

  /** Разрешает auth session для указанного или default profile. */
  public async resolve(profileIdentity?: string | null, opts: { manualToken?: string | null } = {}): Promise<AuthSession> {
    const profile = this.resolveProfile(profileIdentity)
    if (!profile)
      return {}
    return this.resolveWithAdapter(profile, opts)
  }

  /** Проверяет profile и требует непустой access token. */
  public async test(profile: RAuthProfile | AuthProfileSchema): Promise<AuthSession> {
    const session = await this.resolveWithAdapter(profile)
    if (!session.accessToken)
      throw new Error(this.getEmptySessionMessage(this.profileToSchema(profile)))
    return session
  }

  /** Разрешает auth session по Query request policy. */
  public async resolveRequestAuth(auth: Partial<RQueryAuth> | undefined): Promise<AuthSession> {
    const mode = normalizeAuthMode(auth?.mode)
    if (mode === 'none')
      return {}
    if (mode === 'manual')
      return this.resolveWithAdapter(this.createManualTokenProfile(), { manualToken: auth?.manualToken })
    if (mode === 'profile')
      return this.resolve(auth?.profile ?? auth?.authProfileIdentity)
    return this.resolve()
  }

  /** Возвращает access token указанного profile. */
  public async getAccessToken(profileIdentity?: string | null): Promise<string | undefined> {
    const session = await this.resolve(profileIdentity)
    return session.accessToken
  }

  /** Завершает session указанного profile через его adapter. */
  public async logout(profileIdentity?: string | null): Promise<void> {
    const profile = this.resolveProfile(profileIdentity)
    if (!profile)
      return
    const adapter = this.getAdapter(profile.adapterId)
    if (!adapter?.logout)
      return
    await adapter.logout({
      profile: this.profileToSchema(profile),
    })
  }

  /** Очищает runtime tokens и восстанавливает встроенные adapters. */
  public reset(): void {
    this.adapters.clear()
    this.memoryTokens.clear()
    this.registerBuiltInAdapters()
  }

  /** Регистрирует встроенные manual и Keycloak adapters. */
  private registerBuiltInAdapters(): void {
    if (this.adapters.size > 0)
      return
    this.registerAdapter({
      id: 'manual_token',
      label: 'Manual token',
      resolve: async ctx => this.resolveManualToken(ctx.manualToken ?? stringFromConfig(ctx.profile, 'manualToken')),
    })
    this.registerAdapter({
      id: 'keycloak_manual',
      label: 'Keycloak manual',
      resolve: async ctx => this.resolveKeycloakProfile(ctx.profile),
      logout: async ctx => this.logoutKeycloakProfile(ctx.profile),
    })
    this.registerAdapter({
      id: 'keycloak_form',
      label: 'Keycloak form',
      resolve: async ctx => this.resolveKeycloakProfile(ctx.profile),
      logout: async ctx => this.logoutKeycloakProfile(ctx.profile),
    })
  }

  /** Находит auth profile по identity или выбирает default profile. */
  private resolveProfile(profileIdentity?: string | null): RAuthProfile | AuthProfileSchema | null {
    const identity = String(profileIdentity ?? '').trim()
    if (identity) {
      const persisted = Endge.domain.getAuthProfile(identity)
      if (persisted)
        return persisted
      return null
    }
    return this.getDefaultProfile()
  }

  /** Разрешает session через adapter конкретного profile. */
  private async resolveWithAdapter(profile: RAuthProfile | AuthProfileSchema, opts: { manualToken?: string | null } = {}): Promise<AuthSession> {
    const adapter = this.getAdapter(profile.adapterId)
    if (!adapter)
      throw new Error(`[EndgeAuthProfiles.resolve] Unknown auth adapter: ${profile.adapterId}`)
    return adapter.resolve({
      profile: this.profileToSchema(profile),
      manualToken: opts.manualToken ?? undefined,
    })
  }

  /** Создаёт virtual profile для ручного request token. */
  private createManualTokenProfile(): AuthProfileSchema {
    return {
      id: '_manual_token_request_auth',
      identity: '_manual_token_request_auth',
      name: 'Manual token request auth',
      displayName: 'Manual token request auth',
      adapterId: 'manual_token',
      config: {},
      credentialRefs: {},
      persist: 'memory',
      active: true,
      meta: { virtual: true },
    }
  }

  /** Разрешает ручной token и формирует Authorization header. */
  private async resolveManualToken(raw: string | null | undefined): Promise<AuthSession> {
    const value = String(raw ?? '').trim()
    const token = String(Endge.workspace.variables.resolve(value) ?? '').trim()
    if (!token) {
      throw new Error(
        'manual_token требует заполненного config.manualToken. Можно указать прямой токен или переменную, например {API_TOKEN}.',
      )
    }
    return {
      accessToken: token,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  }

  /** Выполняет Keycloak login или восстанавливает сохранённую session. */
  private async resolveKeycloakProfile(profile: AuthProfileSchema): Promise<AuthSession> {
    const auth = this.getKeycloakConfig(profile)

    if (profile.adapterId === 'keycloak_manual') {
      this.requireResolvedValue(auth.baseUrl, 'Keycloak Base URL', 'config.KeycloakBaseUrl', '{ENDPOINT_AUTH}')
      this.requireResolvedValue(auth.clientId, 'Client ID', 'config.clientId', '{KEYCLOAK_CLIENT_ID}')
      this.requireResolvedValue(auth.login, 'Login', 'config.login', '{KEYCLOAK_LOGIN}')
      this.requireResolvedValue(auth.password, 'Password', 'config.password', '{KEYCLOAK_PASSWORD}')

      const client = new KeycloakAuthClient(auth.baseUrl, auth.tokenPath, auth.logoutPath)
      const data = await client.passwordGrant({
        username: auth.login,
        password: auth.password,
        client_id: auth.clientId,
        grant_type: 'password',
        scope: auth.scope,
      })
      const stored = mapTokenResponseToStored(data)
      this.saveStoredToken(profile, stored)
      return this.sessionFromStoredToken(stored)
    }

    const stored = this.loadStoredToken(profile)
    if (!stored)
      return {}
    if (this.isStoredTokenExpired(stored))
      return {}

    return this.sessionFromStoredToken(stored)
  }

  /** Завершает Keycloak session и очищает локальный token. */
  private async logoutKeycloakProfile(profile: AuthProfileSchema): Promise<void> {
    const auth = this.getKeycloakConfig(profile)
    const stored = this.loadStoredToken(profile)
    if (stored?.refresh_token && auth.baseUrl && auth.clientId) {
      try {
        const client = new KeycloakAuthClient(auth.baseUrl, auth.tokenPath, auth.logoutPath)
        await client.logout({
          client_id: auth.clientId,
          refresh_token: stored.refresh_token,
        })
      }
      catch {
        // Logout должен очистить локальное состояние даже если сервер уже недоступен.
      }
    }

    this.removeStoredToken(profile)
  }

  /** Преобразует сохранённый token в публичную auth session. */
  private sessionFromStoredToken(stored: StoredAuthToken): AuthSession {
    const token = String(stored.access_token ?? '').trim()
    if (!token)
      return {}
    return {
      accessToken: token,
      headers: {
        Authorization: `Bearer ${token}`,
      },
      expiresAt: stored.access_expires ? new Date(stored.access_expires).getTime() : null,
      raw: stored,
    }
  }

  /** Приводит domain profile к transport-neutral schema. */
  private profileToSchema(profile: RAuthProfile | AuthProfileSchema): AuthProfileSchema {
    if ('toPlain' in profile && typeof profile.toPlain === 'function')
      return profile.toPlain() as unknown as AuthProfileSchema
    return profile as AuthProfileSchema
  }

  /** Собирает нормализованный Keycloak config из profile. */
  private getKeycloakConfig(profile: AuthProfileSchema): {
    baseUrl: string
    storageKey: string
    clientId: string
    scope: string
    refreshSkewMs: number
    tokenPath: string
    logoutPath: string
    login: string
    password: string
  } {
    const config = profile.config ?? {}
    return {
      baseUrl: this.resolveConfigString(config.KeycloakBaseUrl),
      storageKey: this.resolveConfigString(config.storageKey) || `endge.auth.${profile.identity}`,
      clientId: this.resolveConfigString(config.clientId),
      scope: this.resolveConfigString(config.scope) || 'email openid',
      refreshSkewMs: Number(config.refreshSkewMs ?? 30_000),
      tokenPath: this.resolveConfigString(config.tokenPath) || '/token',
      logoutPath: this.resolveConfigString(config.logoutPath) || '/logout',
      login: this.resolveConfigString(config.login),
      password: this.resolveConfigString(config.password),
    }
  }

  /** Разрешает строковое config value через Endge variables. */
  private resolveConfigString(raw: unknown): string {
    const value = String(raw ?? '').trim()
    if (!value)
      return ''
    return String(Endge.workspace.variables.resolve(value) ?? '').trim()
  }

  /** Проверяет обязательное resolved config value. */
  private requireResolvedValue(
    value: string,
    label: string,
    path: string,
    example: string,
  ): void {
    if (value)
      return
    throw new Error(`${label} не задан. Заполните ${path} напрямую или через переменную, например ${example}.`)
  }

  /** Возвращает storage key auth profile. */
  private getStorageKey(profile: AuthProfileSchema): string {
    const key = this.resolveConfigString(profile.config?.storageKey)
    return key || `endge.auth.${profile.identity}`
  }

  /** Загружает token из выбранного profile storage. */
  private loadStoredToken(profile: AuthProfileSchema): StoredAuthToken | null {
    if (profile.persist === 'memory')
      return this.memoryTokens.get(profile.identity) ?? null

    const storage = profile.persist === 'sessionStorage' ? sessionStorage : localStorage
    const raw = storage.getItem(this.getStorageKey(profile))
    if (!raw)
      return null

    try {
      const parsed = JSON.parse(raw)
      return this.isStoredAuthToken(parsed) ? parsed : null
    }
    catch {
      return null
    }
  }

  /** Сохраняет token согласно persistence policy profile. */
  private saveStoredToken(profile: AuthProfileSchema, token: StoredAuthToken): void {
    if (profile.persist === 'memory') {
      this.memoryTokens.set(profile.identity, token)
      return
    }

    const storage = profile.persist === 'sessionStorage' ? sessionStorage : localStorage
    storage.setItem(this.getStorageKey(profile), JSON.stringify(token))
  }

  /** Удаляет token profile из всех поддерживаемых storages. */
  private removeStoredToken(profile: AuthProfileSchema): void {
    this.memoryTokens.delete(profile.identity)
    localStorage.removeItem(this.getStorageKey(profile))
    sessionStorage.removeItem(this.getStorageKey(profile))
  }

  /** Проверяет минимальную структуру сохранённого auth token. */
  private isStoredAuthToken(value: unknown): value is StoredAuthToken {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false
    const token = value as Record<string, unknown>
    return typeof token.access_token === 'string'
      && typeof token.access_expires === 'string'
  }

  /** Проверяет истечение сохранённого access token. */
  private isStoredTokenExpired(token: StoredAuthToken): boolean {
    const expiresAt = new Date(token.access_expires).getTime()
    return Number.isFinite(expiresAt) && expiresAt <= Date.now()
  }

  /** Формирует диагностическое сообщение для пустой auth session. */
  private getEmptySessionMessage(profile: AuthProfileSchema): string {
    if (profile.adapterId === 'keycloak_form') {
      const storageKey = this.getStorageKey(profile)
      return `Keycloak (form) не нашел активную сессию в storageKey "${storageKey}". Сначала выполните авторизацию через форму или проверьте config.storageKey.`
    }
    if (profile.adapterId === 'manual_token') {
      return 'manual_token не вернул токен. Заполните config.manualToken напрямую или через переменную, например {API_TOKEN}.'
    }
    return `Адаптер "${profile.adapterId}" не вернул access token.`
  }
}

function normalizeAuthMode(mode: unknown): 'inherit' | 'profile' | 'manual' | 'none' {
  const value = String(mode ?? '').trim()
  if (value === 'none' || value === 'profile' || value === 'manual')
    return value
  return 'inherit'
}

function stringFromConfig(profile: AuthProfileSchema, key: string): string | undefined {
  const value = profile.config?.[key]
  return value == null ? undefined : String(value)
}
