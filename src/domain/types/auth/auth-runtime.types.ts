import type { AuthProfileAdapterId, AuthTokenSet } from '@/domain/types/auth/auth-profile.types'

export interface AuthSessionSnapshot {
  version: 1
  profileIdentity: string
  adapterId: AuthProfileAdapterId
  token: AuthTokenSet
  updatedAt: string
}

export interface AuthSessionState {
  token: AuthTokenSet
  userInfo: Record<string, unknown> | null
}

export interface KeycloakTokenResponse {
  access_token: string
  expires_in?: number
  refresh_expires_in?: number
  refresh_token?: string
  token_type?: string
  id_token?: string
  session_state?: string
  scope?: string
}

export interface KeycloakTransportConfig {
  baseUrl: string
  tokenPath: string
  logoutPath: string
  userinfoPath: string
}

export interface KeycloakAuthTransport {
  passwordGrant(payload: Record<string, string>, signal?: AbortSignal): Promise<KeycloakTokenResponse>
  refreshGrant(payload: Record<string, string>, signal?: AbortSignal): Promise<KeycloakTokenResponse>
  logout(payload: Record<string, string>, signal?: AbortSignal): Promise<void>
  getUserInfo(accessToken: string, signal?: AbortSignal): Promise<Record<string, unknown>>
}

export type KeycloakAuthTransportFactory = (config: KeycloakTransportConfig) => KeycloakAuthTransport
