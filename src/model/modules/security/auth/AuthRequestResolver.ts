import type {
  AuthRequestPolicy,
  AuthResolvedSession,
  AuthResolveOptions,
} from '@/domain/types/auth/auth-profile.types'

import type { AuthProfileRegistry } from '@/model/modules/security/auth/AuthProfileRegistry'
import type { AuthSessionManager } from '@/model/modules/security/auth/AuthSessionManager'

/** Разрешает auth policy запроса без изменения sessions других profiles. */
export class AuthRequestResolver {
  public constructor(
    private readonly _profiles: AuthProfileRegistry,
    private readonly _sessions: AuthSessionManager,
  ) {}

  /** Возвращает transport-neutral credentials для none/inherit/profile policy. */
  public async resolve(policy: AuthRequestPolicy, options: AuthResolveOptions = {}): Promise<AuthResolvedSession> {
    if (policy.mode === 'none') {
      return {
        profileIdentity: null,
        headers: {},
        expiresAt: null,
      }
    }

    const profile = policy.mode === 'inherit'
      ? this._profiles.getDefault()
      : this._profiles.requireActive(policy.profileIdentity)
    if (!profile) {
      return {
        profileIdentity: null,
        headers: {},
        expiresAt: null,
      }
    }

    const token = await this._sessions.ensureProfile(profile, options)
    if (!token?.accessToken)
      throw new Error(`[EndgeAuth] Authentication is required: ${profile.identity}`)
    return this._sessions.toResolvedSession(profile, token)
  }
}
