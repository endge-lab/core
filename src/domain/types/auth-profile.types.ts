export type AuthProfileAdapterId = 'keycloak_manual' | 'keycloak_form' | 'manual_token'

export type AuthProfilePersist = 'localStorage' | 'sessionStorage' | 'memory'

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

export interface AuthSession {
  accessToken?: string
  headers?: Record<string, string>
  expiresAt?: number | null
  subject?: string | null
  claims?: Record<string, unknown>
  raw?: unknown
}

export interface AuthProfileAdapterContext {
  profile: AuthProfileSchema
  manualToken?: string
  credentials?: Record<string, string>
}

export interface AuthProfileAdapter {
  id: AuthProfileAdapterId | string
  label: string
  resolve(ctx: AuthProfileAdapterContext): Promise<AuthSession>
  logout?(ctx: AuthProfileAdapterContext): Promise<void>
}
