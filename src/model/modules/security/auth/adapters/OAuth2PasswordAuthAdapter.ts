import type { AuthAdapterContext, AuthProfileAdapter, AuthProfileSchema, AuthTokenSet } from '@/domain/types/auth/auth-profile.types'

const CONFIG_KEYS = ['clientId', 'scopes', 'tokenEndpoint']

/** Выполняет OAuth2 Resource Owner Password grant для dev/test профилей. */
export class OAuth2PasswordAuthAdapter implements AuthProfileAdapter {
  public readonly id = 'oauth2-password'
  public readonly label = 'OAuth2 Password (dev/test)'

  public validate(profile: AuthProfileSchema): void {
    const unexpected = Object.keys(profile.config ?? {}).find(key => !CONFIG_KEYS.includes(key))
    if (unexpected) {
      throw new Error(`[EndgeAuth] Unsupported OAuth2 Password config field "${unexpected}"`)
    }
    if (!String(profile.config.tokenEndpoint ?? '').trim() || !String(profile.config.clientId ?? '').trim()) {
      throw new Error(`[EndgeAuth] OAuth2 Password profile "${profile.identity}" requires tokenEndpoint and clientId`)
    }
    if (!Array.isArray(profile.config.scopes) || profile.config.scopes.some(scope => !String(scope ?? '').trim())) {
      throw new Error(`[EndgeAuth] OAuth2 Password profile "${profile.identity}" has invalid scopes`)
    }
    const keys = Object.keys(profile.credentials ?? {}).sort()
    if (keys.length !== 2 || keys[0] !== 'password' || keys[1] !== 'username') {
      throw new Error(`[EndgeAuth] OAuth2 Password profile "${profile.identity}" requires only credentials.username and credentials.password`)
    }
    if (!String(profile.credentials.username ?? '').trim() || !String(profile.credentials.password ?? '').trim()) {
      throw new Error(`[EndgeAuth] OAuth2 Password profile "${profile.identity}" requires username and password`)
    }
    if (!profile.session || !['memory', 'sessionStorage', 'localStorage'].includes(profile.session.storage)) {
      throw new Error(`[EndgeAuth] OAuth2 Password profile "${profile.identity}" requires session policy`)
    }
    if (typeof profile.session.persistRefreshToken !== 'boolean') {
      throw new TypeError(`[EndgeAuth] Invalid refresh token policy: ${profile.identity}`)
    }
  }

  public async authenticate(context: AuthAdapterContext): Promise<AuthTokenSet> {
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: context.resolveValue(context.profile.config.clientId),
      username: await context.resolveCredential('username'),
      password: await context.resolveCredential('password'),
    })
    this._appendScopes(context, body)
    return this._requestToken(context, body)
  }

  public async refresh(context: AuthAdapterContext): Promise<AuthTokenSet> {
    const refreshToken = String(context.token?.refreshToken ?? '').trim()
    if (!refreshToken) {
      throw new Error(`[EndgeAuth] OAuth2 Password refresh token is unavailable: ${context.profile.identity}`)
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: context.resolveValue(context.profile.config.clientId),
      refresh_token: refreshToken,
    })
    this._appendScopes(context, body)
    return this._requestToken(context, body, refreshToken)
  }

  private _appendScopes(context: AuthAdapterContext, body: URLSearchParams): void {
    const scopes = (context.profile.config.scopes as unknown[])
      .map(scope => context.resolveValue(scope))
      .filter(Boolean)
    if (scopes.length) {
      body.set('scope', scopes.join(' '))
    }
  }

  private async _requestToken(context: AuthAdapterContext, body: URLSearchParams, previousRefreshToken?: string): Promise<AuthTokenSet> {
    const endpoint = context.resolveValue(context.profile.config.tokenEndpoint)
    const response = await fetch(endpoint, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: context.signal,
    })
    const payload = await readPayload(response)
    if (!response.ok) {
      throw tokenRequestError(payload, response.status)
    }
    const accessToken = String(payload.access_token ?? '').trim()
    if (!accessToken) {
      throw new Error(`[EndgeAuth] OAuth2 Password returned an empty access token: ${context.profile.identity}`)
    }
    const expiresIn = Number(payload.expires_in)
    const refreshExpiresIn = Number(payload.refresh_expires_in)
    const refreshToken = String(payload.refresh_token ?? '').trim() || previousRefreshToken
    return {
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      ...(String(payload.id_token ?? '').trim() ? { idToken: String(payload.id_token).trim() } : {}),
      ...(String(payload.session_state ?? '').trim() ? { sessionState: String(payload.session_state).trim() } : {}),
      accessExpiresAt: Number.isFinite(expiresIn) ? Date.now() + expiresIn * 1000 : null,
      ...(Number.isFinite(refreshExpiresIn) ? { refreshExpiresAt: Date.now() + refreshExpiresIn * 1000 } : {}),
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  }
}

async function readPayload(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>
  }
  catch {
    return {}
  }
}

function tokenRequestError(payload: Record<string, unknown>, status: number): Error {
  const code = String(payload.error ?? '').trim() || `http_${status}`
  const error = new Error(`[EndgeAuth] OAuth2 Password token request failed: ${code}`) as Error & { code: string }
  error.code = code
  return error
}
