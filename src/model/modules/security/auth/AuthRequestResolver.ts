import type {
  AuthRequestPolicy,
  AuthResolvedSession,
  AuthResolveOptions,
} from '@/domain/types/auth/auth-profile.types'

import type { AuthProfileRegistry } from '@/model/modules/security/auth/AuthProfileRegistry'
import type { AuthSessionManager } from '@/model/modules/security/auth/AuthSessionManager'
import { AuthInteractionRequiredError } from '@/model/modules/security/auth/AuthInteractionRequiredError'

/** Разрешает auth policy запроса без изменения sessions других profiles. */
export class AuthRequestResolver {
  public constructor(
    private readonly _profiles: AuthProfileRegistry,
    private readonly _sessions: AuthSessionManager,
    private readonly _onInteractionRequired?: (error: AuthInteractionRequiredError) => void,
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
      : this._profiles.requireActive(policy.profile)
    if (!profile) {
      return {
        profileIdentity: null,
        headers: {},
        expiresAt: null,
      }
    }

    let token
    try {
      token = await this._sessions.ensureProfile(profile, options)
    }
    catch (error) {
      if (error instanceof AuthInteractionRequiredError)
        this._publishAndThrow(error)
      throw error
    }
    if (!token)
      this._throwInteractionRequired(profile.identity)
    const session = this._sessions.toResolvedSession(profile, token)
    if (Object.keys(session.headers).length === 0)
      this._throwInteractionRequired(profile.identity)
    return session
  }

  /** Publishes the typed host signal before the request fails. */
  private _throwInteractionRequired(profileIdentity: string): never {
    this._publishAndThrow(new AuthInteractionRequiredError(profileIdentity))
  }

  private _publishAndThrow(error: AuthInteractionRequiredError): never {
    this._onInteractionRequired?.(error)
    throw error
  }
}
