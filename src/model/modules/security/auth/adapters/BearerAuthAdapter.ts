import type {
  AuthAdapterContext,
  AuthProfileAdapter,
  AuthProfileSchema,
  AuthTokenSet,
} from '@/domain/types/auth/auth-profile.types'

/** Материализует Bearer header из literal или Workspace variable. */
export class BearerAuthAdapter implements AuthProfileAdapter {
  public readonly id = 'bearer'
  public readonly label = 'Bearer token'

  /** Проверяет строгий persisted contract bearer profile. */
  public validate(profile: AuthProfileSchema): void {
    if (Object.keys(profile.config ?? {}).length > 0) {
      throw new Error(`[EndgeAuth] Bearer profile "${profile.identity}" config must be empty`)
    }
    if (profile.session) {
      throw new Error(`[EndgeAuth] Bearer profile "${profile.identity}" must not define session`)
    }
    const keys = Object.keys(profile.credentials ?? {})
    if (keys.length !== 1 || keys[0] !== 'token' || !String(profile.credentials.token ?? '').trim()) {
      throw new Error(`[EndgeAuth] Bearer profile "${profile.identity}" requires only credentials.token`)
    }
  }

  /** Получает token у host и не сохраняет его в browser storage. */
  public async authenticate(context: AuthAdapterContext): Promise<AuthTokenSet> {
    const accessToken = (await context.resolveCredential('token')).trim()
    if (!accessToken) {
      throw new Error(`[EndgeAuth] Bearer credential is empty: ${context.profile.identity}`)
    }
    return {
      accessToken,
      accessExpiresAt: null,
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  }
}
