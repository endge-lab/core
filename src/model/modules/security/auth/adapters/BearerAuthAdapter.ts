import type {
  AuthAdapterContext,
  AuthProfileAdapter,
  AuthProfileSchema,
  AuthTokenSet,
} from '@/domain/types/auth/auth-profile.types'

/** Разрешает opaque bearer token исключительно через host credential resolver. */
export class BearerAuthAdapter implements AuthProfileAdapter {
  public readonly id = 'bearer'
  public readonly label = 'Bearer token'

  /** Проверяет строгий persisted contract bearer profile. */
  public validate(profile: AuthProfileSchema): void {
    if (Object.keys(profile.config ?? {}).length > 0)
      throw new Error(`[EndgeAuth] Bearer profile "${profile.identity}" config must be empty`)
    if (profile.persist !== 'memory')
      throw new Error(`[EndgeAuth] Bearer profile "${profile.identity}" must use persist=memory`)
    if (!String(profile.credentialRefs?.token ?? '').trim())
      throw new Error(`[EndgeAuth] Bearer profile "${profile.identity}" requires credentialRefs.token`)
  }

  /** Получает token у host и не сохраняет его в browser storage. */
  public async authenticate(context: AuthAdapterContext): Promise<AuthTokenSet> {
    const accessToken = (await context.resolveCredential('token')).trim()
    if (!accessToken)
      throw new Error(`[EndgeAuth] Bearer credential is empty: ${context.profile.identity}`)
    return { accessToken, accessExpiresAt: null }
  }
}
