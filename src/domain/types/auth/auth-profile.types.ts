export type AuthProfileAdapterId = 'keycloak' | 'bearer' | (string & {})

export type AuthProfilePersist = 'localStorage' | 'sessionStorage' | 'memory'

export type AuthLoginMode = 'interactive' | 'service'

export interface AuthProfileConfig {
  [key: string]: unknown
}

export interface AuthProfileCredentialRefs {
  [key: string]: string | undefined
}

export interface AuthProfileSchema {
  id: string | number
  identity: string
  name: string
  displayName: string
  description?: string | null
  adapterId: AuthProfileAdapterId
  config: AuthProfileConfig
  credentialRefs: AuthProfileCredentialRefs
  persist: AuthProfilePersist
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
    | { mode: 'profile', profileIdentity: string }

export interface AuthResolveOptions {
  forceRefresh?: boolean
}

export interface AuthLoginCredentials {
  username: string
  password: string
}

export interface AuthEnsureOptions {
  forceRefresh?: boolean
  /** Запрещает первичный auto-login service-профиля, сохраняя restore и refresh. */
  allowServiceLogin?: boolean
}

/** Минимальный синхронный auth context без tokens и полного claims payload. */
export interface EndgeAuthContext {
  authenticated: boolean
  subject?: string
  sessionId?: string
  profileIdentity?: string
}

export interface AuthCredentialResolveInput {
  ref: string
  profileIdentity: string
  credential: string
  signal?: AbortSignal
}

export type EndgeAuthCredentialResolver = (
  input: AuthCredentialResolveInput,
) => string | undefined | Promise<string | undefined>

export interface EndgeAuthBootOptions {
  resolveCredential?: EndgeAuthCredentialResolver
  /** Host-owned namespace isolates persisted sessions of identical Workspaces across backends. */
  storageNamespace?: string
}

export interface AuthAdapterContext {
  profile: AuthProfileSchema
  credentials?: Record<string, string>
  token?: AuthTokenSet
  signal?: AbortSignal
  resolveCredential: (credential: string) => Promise<string>
}

/** Контракт расширяемого auth adapter. Storage и application state остаются в EndgeAuth. */
export interface AuthProfileAdapter {
  id: AuthProfileAdapterId
  label: string
  validate(profile: AuthProfileSchema): void
  authenticate(context: AuthAdapterContext): Promise<AuthTokenSet>
  refresh?(context: AuthAdapterContext): Promise<AuthTokenSet>
  logout?(context: AuthAdapterContext): Promise<void>
  loadUserInfo?(context: AuthAdapterContext): Promise<Record<string, unknown> | null>
}

export interface AuthProfileTestOptions {
  credentials?: Record<string, string>
}

export interface AuthProfileTestResult {
  authenticated: boolean
  profileIdentity: string
  expiresAt: number | null
  context: EndgeAuthContext
  userInfo: Record<string, unknown> | null
}
