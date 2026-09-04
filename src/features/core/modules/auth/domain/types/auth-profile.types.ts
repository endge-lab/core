export type AuthProfileAdapterId
  = | 'oidc'
    | 'oauth2-client-credentials'
    | 'oauth2-password'
    | 'basic'
    | 'bearer'
    | (string & {})

export type AuthSessionStorage = 'localStorage' | 'sessionStorage' | 'memory'

export interface AuthSessionPolicy {
  storage: AuthSessionStorage
  persistRefreshToken: boolean
}

export interface AuthProfileConfig {
  [key: string]: unknown
}

export interface AuthProfileCredentials {
  [key: string]: string
}

/** Сохраняемый дискриминированный контракт встроенных адаптеров. */
export interface AuthProfileBase {
  id: string
  identity: string
  name: string
  description?: string
  active: boolean
  adapterId: string
  config: Record<string, unknown>
  credentials: Record<string, string>
}

export interface OidcAuthProfile extends AuthProfileBase {
  adapterId: 'oidc'
  config: { issuer: string, clientId: string, scopes: string[] }
  credentials: Record<string, never>
  session: AuthSessionPolicy
}

export interface OAuth2ClientCredentialsProfile extends AuthProfileBase {
  adapterId: 'oauth2-client-credentials'
  config: {
    tokenEndpoint: string
    clientId: string
    scopes: string[]
    clientAuthentication: 'client_secret_basic' | 'client_secret_post'
  }
  credentials: { clientSecret: string }
  session: AuthSessionPolicy
}

export interface OAuth2PasswordProfile extends AuthProfileBase {
  adapterId: 'oauth2-password'
  config: {
    tokenEndpoint: string
    clientId: string
    scopes: string[]
  }
  credentials: { username: string, password: string }
  session: AuthSessionPolicy
}

export interface BasicAuthProfile extends AuthProfileBase {
  adapterId: 'basic'
  config: Record<string, never>
  credentials: { username: string, password: string }
  session?: never
}

export interface BearerAuthProfile extends AuthProfileBase {
  adapterId: 'bearer'
  config: Record<string, never>
  credentials: { token: string }
  session?: never
}

export type AuthProfile
  = | OidcAuthProfile
    | OAuth2ClientCredentialsProfile
    | OAuth2PasswordProfile
    | BasicAuthProfile
    | BearerAuthProfile

/** Runtime-проекция также принимает структурно проверенные расширения реестра и legacy числовые ID. */
export interface AuthProfileSchema {
  id: string | number
  identity: string
  name: string
  displayName: string
  description?: string | null
  adapterId: AuthProfileAdapterId
  config: AuthProfileConfig
  credentials: AuthProfileCredentials
  session?: AuthSessionPolicy
  folderId?: string | number | null
  active: boolean
  deletedAt?: string | null
  meta?: Record<string, unknown>
}

export interface AuthTokenSet {
  accessToken: string
  refreshToken?: string
  idToken?: string
  sessionState?: string
  accessExpiresAt: number | null
  refreshExpiresAt?: number | null
  headers?: Record<string, string>
}

export interface AuthResolvedSession {
  profileIdentity: string | null
  accessToken?: string
  headers: Record<string, string>
  expiresAt: number | null
  subject?: string
  sessionId?: string
}

export type AuthRequestPolicy
  = | { mode: 'none' }
    | { mode: 'inherit' }
    | { mode: 'profile', profile: string }

export interface AuthResolveOptions {
  forceRefresh?: boolean
}

export interface AuthEnsureOptions {
  forceRefresh?: boolean
}

export interface AuthSessionSourceResolveOptions {
  forceRefresh: boolean
  minValiditySeconds: number
}

/** Host-owned источник session для внешнего Authorization Code + PKCE flow. */
export interface AuthSessionSource {
  resolveToken: (options: AuthSessionSourceResolveOptions) => Promise<AuthTokenSet | null>
  logout?: () => Promise<void>
  loadUserInfo?: () => Promise<Record<string, unknown> | null>
}

/** Минимальный синхронный auth context без tokens и полного claims payload. */
export interface EndgeAuthContext {
  authenticated: boolean
  subject?: string
  sessionId?: string
  profileIdentity?: string
}

export interface EndgeAuthBootOptions {
  /** Host-owned namespace isolates sessions одинаковых Workspaces across backends. */
  storageNamespace?: string
}

export interface AuthAdapterContext {
  profile: AuthProfileSchema
  token?: AuthTokenSet
  signal?: AbortSignal
  resolveValue: (value: unknown) => string
  resolveCredential: (credential: string) => Promise<string>
}

/** Контракт расширяемого auth adapter. Storage и application state остаются в EndgeAuth_Module. */
export interface AuthProfileAdapter {
  id: AuthProfileAdapterId
  label: string
  validate: (profile: AuthProfileSchema) => void
  authenticate: (context: AuthAdapterContext) => Promise<AuthTokenSet>
  refresh?: (context: AuthAdapterContext) => Promise<AuthTokenSet>
  logout?: (context: AuthAdapterContext) => Promise<void>
  loadUserInfo?: (context: AuthAdapterContext) => Promise<Record<string, unknown> | null>
}

export interface AuthProfileTestResult {
  authenticated: boolean
  profileIdentity: string
  expiresAt: number | null
  context: EndgeAuthContext
  userInfo: Record<string, unknown> | null
}

export interface OidcBrowserSessionOptions {
  issuer: string
  clientId: string
  scopes: string[]
  redirectUri: string
  popupRedirectUri?: string
  postLogoutRedirectUri?: string
  session: AuthSessionPolicy
  storageNamespace: string
  profileIdentity: string
  flow: 'popup' | 'redirect'
}
