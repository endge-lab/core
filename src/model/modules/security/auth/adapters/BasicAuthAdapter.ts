import type { AuthAdapterContext, AuthProfileAdapter, AuthProfileSchema, AuthTokenSet } from '@/domain/types/auth/auth-profile.types'

/** Материализует HTTP Basic header без token session. */
export class BasicAuthAdapter implements AuthProfileAdapter {
  public readonly id = 'basic'
  public readonly label = 'Basic'

  /** Проверяет строгий Basic contract. */
  public validate(profile: AuthProfileSchema): void {
    if (Object.keys(profile.config ?? {}).length > 0)
      throw new Error(`[EndgeAuth] Basic profile "${profile.identity}" config must be empty`)
    if (profile.session)
      throw new Error(`[EndgeAuth] Basic profile "${profile.identity}" must not define session`)
    const keys = Object.keys(profile.credentials ?? {}).sort()
    if (keys.join(',') !== 'password,username')
      throw new Error(`[EndgeAuth] Basic profile "${profile.identity}" requires only username and password`)
    if (!String(profile.credentials.username ?? '').trim() || !String(profile.credentials.password ?? '').trim())
      throw new Error(`[EndgeAuth] Basic profile "${profile.identity}" credentials are required`)
  }

  /** Разрешает credentials и возвращает готовый Authorization header. */
  public async authenticate(context: AuthAdapterContext): Promise<AuthTokenSet> {
    const username = await context.resolveCredential('username')
    const password = await context.resolveCredential('password')
    const encoded = encodeBase64(`${username}:${password}`)
    return {
      accessToken: '',
      accessExpiresAt: null,
      headers: { Authorization: `Basic ${encoded}` },
    }
  }
}

function encodeBase64(value: string): string {
  if (typeof btoa === 'function')
    return btoa(String.fromCharCode(...new TextEncoder().encode(value)))
  throw new Error('[EndgeAuth] Base64 encoder is unavailable')
}
