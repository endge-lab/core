import type { AuthAdapterContext, AuthProfileAdapter, AuthProfileSchema, AuthTokenSet } from '@/modules/auth/domain/types/auth-profile.types'

import { AuthInteractionRequiredError } from '@/modules/auth/domain/AuthInteractionRequiredError'

const CONFIG_KEYS = ['clientId', 'issuer', 'scopes']

/** Валидирует общий OIDC profile; interactive flow запускает host через session source. */
export class OidcAuthAdapter implements AuthProfileAdapter {
  public readonly id = 'oidc'
  public readonly label = 'OIDC'

  public validate(profile: AuthProfileSchema): void {
    requireOnlyKeys(profile.config, CONFIG_KEYS, profile.identity)
    if (!String(profile.config.issuer ?? '').trim() || !String(profile.config.clientId ?? '').trim()) {
      throw new Error(`[EndgeAuth] OIDC profile "${profile.identity}" requires issuer and clientId`)
    }
    const scopes = profile.config.scopes
    if (!Array.isArray(scopes) || scopes.length === 0 || scopes.some(scope => !String(scope ?? '').trim())) {
      throw new Error(`[EndgeAuth] OIDC profile "${profile.identity}" requires non-empty scopes`)
    }
    if (Object.keys(profile.credentials ?? {}).length > 0) {
      throw new Error(`[EndgeAuth] OIDC profile "${profile.identity}" credentials must be empty`)
    }
    validateSession(profile)
  }

  public async authenticate(context: AuthAdapterContext): Promise<AuthTokenSet> {
    throw new AuthInteractionRequiredError(context.profile.identity)
  }
}

function validateSession(profile: AuthProfileSchema): void {
  const session = profile.session
  if (!session || !['memory', 'sessionStorage', 'localStorage'].includes(session.storage)) {
    throw new Error(`[EndgeAuth] Token profile "${profile.identity}" requires session policy`)
  }
  if (typeof session.persistRefreshToken !== 'boolean') {
    throw new TypeError(`[EndgeAuth] Invalid refresh token policy: ${profile.identity}`)
  }
}

function requireOnlyKeys(value: Record<string, unknown>, allowed: string[], identity: string): void {
  const unexpected = Object.keys(value ?? {}).find(key => !allowed.includes(key))
  if (unexpected) {
    throw new Error(`[EndgeAuth] Unsupported OIDC config field "${unexpected}" in profile "${identity}"`)
  }
}
