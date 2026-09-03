import type { AuthAdapterContext, AuthProfileAdapter, AuthProfileSchema, AuthTokenSet } from '@/modules/auth/domain/types/auth-profile.types'

const CONFIG_KEYS = ['clientAuthentication', 'clientId', 'scopes', 'tokenEndpoint']

/** Выполняет OAuth2 Client Credentials grant. */
export class OAuth2ClientCredentialsAuthAdapter implements AuthProfileAdapter {
  public readonly id = 'oauth2-client-credentials'
  public readonly label = 'OAuth2 Client Credentials'

  public validate(profile: AuthProfileSchema): void {
    const unexpected = Object.keys(profile.config ?? {}).find(key => !CONFIG_KEYS.includes(key))
    if (unexpected) {
      throw new Error(`[EndgeAuth] Unsupported Client Credentials config field "${unexpected}"`)
    }
    if (!String(profile.config.tokenEndpoint ?? '').trim() || !String(profile.config.clientId ?? '').trim()) {
      throw new Error(`[EndgeAuth] Client Credentials profile "${profile.identity}" requires tokenEndpoint and clientId`)
    }
    if (!Array.isArray(profile.config.scopes) || profile.config.scopes.some(scope => !String(scope ?? '').trim())) {
      throw new Error(`[EndgeAuth] Client Credentials profile "${profile.identity}" has invalid scopes`)
    }
    if (!['client_secret_basic', 'client_secret_post'].includes(String(profile.config.clientAuthentication ?? ''))) {
      throw new Error(`[EndgeAuth] Client Credentials profile "${profile.identity}" has invalid clientAuthentication`)
    }
    const keys = Object.keys(profile.credentials ?? {})
    if (keys.length !== 1 || keys[0] !== 'clientSecret' || !String(profile.credentials.clientSecret ?? '').trim()) {
      throw new Error(`[EndgeAuth] Client Credentials profile "${profile.identity}" requires only credentials.clientSecret`)
    }
    if (!profile.session || !['memory', 'sessionStorage', 'localStorage'].includes(profile.session.storage)) {
      throw new Error(`[EndgeAuth] Client Credentials profile "${profile.identity}" requires session policy`)
    }
    if (typeof profile.session.persistRefreshToken !== 'boolean') {
      throw new TypeError(`[EndgeAuth] Invalid refresh token policy: ${profile.identity}`)
    }
  }

  public async authenticate(context: AuthAdapterContext): Promise<AuthTokenSet> {
    const endpoint = context.resolveValue(context.profile.config.tokenEndpoint)
    const clientId = context.resolveValue(context.profile.config.clientId)
    const clientSecret = await context.resolveCredential('clientSecret')
    const scopes = (context.profile.config.scopes as unknown[]).map(scope => context.resolveValue(scope)).filter(Boolean)
    const method = String(context.profile.config.clientAuthentication)
    const body = new URLSearchParams({ grant_type: 'client_credentials' })
    if (scopes.length) {
      body.set('scope', scopes.join(' '))
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
    if (method === 'client_secret_basic') {
      headers.Authorization = `Basic ${encodeBase64(`${clientId}:${clientSecret}`)}`
    }
    else {
      body.set('client_id', clientId)
      body.set('client_secret', clientSecret)
    }
    const response = await fetch(endpoint, { method: 'POST', body, headers, signal: context.signal })
    const payload = await response.json() as Record<string, unknown>
    if (!response.ok) {
      throw new Error(`[EndgeAuth] Client Credentials token request failed: ${String(payload.error ?? response.status)}`)
    }
    const accessToken = String(payload.access_token ?? '').trim()
    if (!accessToken) {
      throw new Error(`[EndgeAuth] Client Credentials returned an empty access token: ${context.profile.identity}`)
    }
    const expiresIn = Number(payload.expires_in)
    return {
      accessToken,
      accessExpiresAt: Number.isFinite(expiresIn) ? Date.now() + expiresIn * 1000 : null,
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  }
}

function encodeBase64(value: string): string {
  if (typeof btoa === 'function') {
    return btoa(String.fromCharCode(...new TextEncoder().encode(value)))
  }
  throw new Error('[EndgeAuth] Base64 encoder is unavailable')
}
