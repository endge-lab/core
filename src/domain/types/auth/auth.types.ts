export type AuthPersist = 'localStorage' | 'sessionStorage'

/** Поддерживаемые провайдеры авторизации. */
export type AuthProvider = 'none' | 'keycloak_basic'

/** Базовая часть конфига для Keycloak-совместимых провайдеров. */
export interface KeycloakBaseConfig {
  /** Базовый URL до OpenID Connect endpoints, напр. https://host/auth/realms/my/protocol/openid-connect */
  baseUrl: string
  /** Идентификатор клиента */
  clientId: string
  /** Скоупы через пробел */
  scope?: string
  /** Относительный путь до токен-эндпоинта (обычно /endgeToken) */
  tokenEndpoint?: string
  loginEndpoint?: string
  logoutEndpoint?: string
  /** Автообновление токена перед истечением */
  autoRefresh?: boolean
  /** За сколько миллисекунд до exp обновлять токен */
  refreshSkewMs?: number
  /** Персистентность состояния */
  persist?: AuthPersist
}

/** Конфигурация для password-гранта (движок сам логинится). */
export interface KeycloakBasicConfig extends KeycloakBaseConfig {
  provider: 'keycloak_basic'
  username?: string
  password?: string
}

/** Конфигурация без авторизации. */
export interface NoneAuthConfig {
  provider: 'none'
  persist?: AuthPersist
}

/** Дискриминированный юнион конфига. */
export type AuthConfig = NoneAuthConfig | KeycloakBasicConfig

/** Ответ Keycloak при выдаче/рефреше токена (строго типизированный). */
export interface KeycloakTokenResponse {
  access_token: string
  expires_in: number
  refresh_expires_in: number
  refresh_token: string
  token_type: 'Bearer'
  id_token?: string
  'not-before-policy'?: number
  session_state?: string
  scope?: string
}

/** Состояние токена в рантайме/персисте. */
export interface AuthState {
  accessToken?: string | null
  refreshToken?: string | null
  /** Время истечения accessToken в ms (Date.now() базис) */
  expiresAtMs?: number | null
  /** Время истечения refreshToken в ms (Date.now() базис) */
  refreshExpiresAtMs?: number | null
  /** Метаданные */
  updatedAt?: string
}

/** Полный снапшот для сохранения/восстановления. */
export interface AuthSnapshot {
  config: AuthConfig
  state: AuthState
  /** Версия схемы для миграций */
  version: number
}

export interface StoredAuthToken {
  access_token: string
  refresh_token?: string
  access_expires: string
  refresh_expires?: string
}

export interface KeycloakTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  refresh_expires_in?: number
}

export type EndgeTokenMode = 'inherit' | 'manual' | 'none'

export interface GetAccessTokenOpts {
  mode?: EndgeTokenMode
  manualToken?: string | null
}
