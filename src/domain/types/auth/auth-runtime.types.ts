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
