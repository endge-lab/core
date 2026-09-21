import type { AuthProfileAdapterId, AuthTokenSet } from '@/features/core/modules/auth/domain/types/auth-profile.types'

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
