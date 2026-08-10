import type {
  AuthAdapterContext,
  AuthLoginMode,
  AuthProfileAdapter,
  AuthProfileSchema,
  AuthTokenSet,
} from '@/domain/types/auth/auth-profile.types'
import type {
  KeycloakAuthTransport,
  KeycloakAuthTransportFactory,
  KeycloakTransportConfig,
} from '@/domain/types/auth/auth-runtime.types'

import {
  KeycloakAuthClient,
  mapKeycloakTokenResponse,
} from '@/model/services/auth/KeycloakAuthClient'

const CONFIG_KEYS = new Set([
  'loginMode',
  'baseUrl',
  'clientId',
  'scope',
  'tokenPath',
  'logoutPath',
  'userinfoPath',
  'refreshSkewMs',
])

interface KeycloakConfig extends KeycloakTransportConfig {
  loginMode: AuthLoginMode
  clientId: string
  scope: string
  refreshSkewMs: number
}

/** Keycloak password-grant adapter без владения storage или application state. */
export class KeycloakAuthAdapter implements AuthProfileAdapter {
  public readonly id = 'keycloak'
  public readonly label = 'Keycloak'

  public constructor(
    private readonly _resolvePublicValue: (raw: unknown) => string,
    private readonly _createTransport: KeycloakAuthTransportFactory = config => new KeycloakAuthClient(config),
    private readonly _now: () => number = () => Date.now(),
  ) {}

  /** Проверяет строгий persisted contract Keycloak profile. */
  public validate(profile: AuthProfileSchema): void {
    const config = profile.config ?? {}
    for (const key of Object.keys(config)) {
      if (!CONFIG_KEYS.has(key))
        throw new Error(`[EndgeAuth] Unsupported Keycloak config field "${key}" in profile "${profile.identity}"`)
    }

    const loginMode = String(config.loginMode ?? '').trim()
    if (loginMode !== 'interactive' && loginMode !== 'service')
      throw new Error(`[EndgeAuth] Keycloak profile "${profile.identity}" requires loginMode=interactive|service`)
    if (!String(config.baseUrl ?? '').trim())
      throw new Error(`[EndgeAuth] Keycloak profile "${profile.identity}" requires config.baseUrl`)
    if (!String(config.clientId ?? '').trim())
      throw new Error(`[EndgeAuth] Keycloak profile "${profile.identity}" requires config.clientId`)

    const refreshSkewMs = Number(config.refreshSkewMs ?? 30_000)
    if (!Number.isFinite(refreshSkewMs) || refreshSkewMs < 0)
      throw new Error(`[EndgeAuth] Keycloak profile "${profile.identity}" has invalid refreshSkewMs`)

    const refs = Object.entries(profile.credentialRefs ?? {}).filter(([, value]) => String(value ?? '').trim())
    if (loginMode === 'interactive' && refs.length > 0)
      throw new Error(`[EndgeAuth] Interactive Keycloak profile "${profile.identity}" must not persist credentialRefs`)
    if (loginMode === 'service') {
      if (!String(profile.credentialRefs?.username ?? '').trim())
        throw new Error(`[EndgeAuth] Service Keycloak profile "${profile.identity}" requires credentialRefs.username`)
      if (!String(profile.credentialRefs?.password ?? '').trim())
        throw new Error(`[EndgeAuth] Service Keycloak profile "${profile.identity}" requires credentialRefs.password`)
      if (refs.some(([key]) => key !== 'username' && key !== 'password'))
        throw new Error(`[EndgeAuth] Service Keycloak profile "${profile.identity}" has unsupported credentialRefs`)
    }
  }

  /** Выполняет interactive или service password grant. */
  public async authenticate(context: AuthAdapterContext): Promise<AuthTokenSet> {
    const config = this._config(context.profile)
    const credentials = config.loginMode === 'interactive'
      ? context.credentials ?? {}
      : {
          username: await context.resolveCredential('username'),
          password: await context.resolveCredential('password'),
        }
    const username = String(credentials.username ?? '').trim()
    const password = String(credentials.password ?? '').trim()
    if (!username || !password)
      throw new Error(`[EndgeAuth] Username and password are required: ${context.profile.identity}`)

    const response = await this._transport(config).passwordGrant({
      username,
      password,
      client_id: config.clientId,
      grant_type: 'password',
      scope: config.scope,
    }, context.signal)
    return this._requireToken(mapKeycloakTokenResponse(response, this._now()), context.profile)
  }

  /** Обновляет Keycloak session. */
  public async refresh(context: AuthAdapterContext): Promise<AuthTokenSet> {
    const config = this._config(context.profile)
    const refreshToken = String(context.token?.refreshToken ?? '').trim()
    if (!refreshToken)
      throw new Error(`[EndgeAuth] Refresh token is unavailable: ${context.profile.identity}`)
    const response = await this._transport(config).refreshGrant({
      client_id: config.clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }, context.signal)
    return this._requireToken(mapKeycloakTokenResponse(response, this._now(), context.token), context.profile)
  }

  /** Завершает Keycloak session при наличии refresh token. */
  public async logout(context: AuthAdapterContext): Promise<void> {
    const refreshToken = String(context.token?.refreshToken ?? '').trim()
    if (!refreshToken)
      return
    const config = this._config(context.profile)
    await this._transport(config).logout({
      client_id: config.clientId,
      refresh_token: refreshToken,
    }, context.signal)
  }

  /** Загружает OIDC userinfo. */
  public async loadUserInfo(context: AuthAdapterContext): Promise<Record<string, unknown> | null> {
    const accessToken = String(context.token?.accessToken ?? '').trim()
    if (!accessToken)
      return null
    return this._transport(this._config(context.profile)).getUserInfo(accessToken, context.signal)
  }

  /** Собирает resolved public config без чтения credential material. */
  private _config(profile: AuthProfileSchema): KeycloakConfig {
    this.validate(profile)
    const config = profile.config
    const baseUrl = this._resolvePublicValue(config.baseUrl)
    const clientId = this._resolvePublicValue(config.clientId)
    if (!baseUrl || !clientId)
      throw new Error(`[EndgeAuth] Keycloak public config is unresolved: ${profile.identity}`)
    return {
      loginMode: config.loginMode as AuthLoginMode,
      baseUrl,
      clientId,
      scope: this._resolvePublicValue(config.scope) || 'openid profile email',
      tokenPath: this._resolvePublicValue(config.tokenPath) || '/token',
      logoutPath: this._resolvePublicValue(config.logoutPath) || '/logout',
      userinfoPath: this._resolvePublicValue(config.userinfoPath) || '/userinfo',
      refreshSkewMs: Number(config.refreshSkewMs ?? 30_000),
    }
  }

  private _transport(config: KeycloakConfig): KeycloakAuthTransport {
    return this._createTransport(config)
  }

  private _requireToken(token: AuthTokenSet, profile: AuthProfileSchema): AuthTokenSet {
    if (!token.accessToken)
      throw new Error(`[EndgeAuth] Keycloak returned an empty access token: ${profile.identity}`)
    return token
  }
}
