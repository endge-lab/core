import type { AuthTokenSet } from '@/domain/types/auth/auth-profile.types'
import type {
  KeycloakAuthTransport,
  KeycloakTokenResponse,
  KeycloakTransportConfig,
} from '@/domain/types/auth/auth-runtime.types'
import type { AxiosInstance } from 'axios'

import axios from 'axios'

/** Преобразует transport response Keycloak в runtime token set. */
export function mapKeycloakTokenResponse(
  data: KeycloakTokenResponse,
  now: number = Date.now(),
  previous?: AuthTokenSet,
): AuthTokenSet {
  const accessExpiresAt = data.expires_in == null
    ? null
    : now + Math.max(0, data.expires_in) * 1000
  const refreshExpiresAt = data.refresh_expires_in == null
    ? previous?.refreshExpiresAt ?? null
    : now + Math.max(0, data.refresh_expires_in) * 1000

  return {
    accessToken: String(data.access_token ?? '').trim(),
    accessExpiresAt,
    refreshToken: data.refresh_token ?? previous?.refreshToken,
    refreshExpiresAt,
    idToken: data.id_token ?? previous?.idToken,
    sessionState: data.session_state ?? previous?.sessionState,
  }
}

/** Axios transport для стандартных Keycloak OIDC endpoints. */
export class KeycloakAuthClient implements KeycloakAuthTransport {
  private readonly _http: AxiosInstance
  private readonly _tokenPath: string
  private readonly _logoutPath: string
  private readonly _userinfoPath: string

  public constructor(config: KeycloakTransportConfig, http?: AxiosInstance) {
    this._http = http ?? axios.create({
      baseURL: config.baseUrl,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    this._tokenPath = config.tokenPath
    this._logoutPath = config.logoutPath
    this._userinfoPath = config.userinfoPath
  }

  /** Выполняет password grant. */
  public async passwordGrant(payload: Record<string, string>, signal?: AbortSignal): Promise<KeycloakTokenResponse> {
    const { data } = await this._http.post<KeycloakTokenResponse>(this._tokenPath, new URLSearchParams(payload).toString(), { signal })
    return data
  }

  /** Обновляет access token через refresh token. */
  public async refreshGrant(payload: Record<string, string>, signal?: AbortSignal): Promise<KeycloakTokenResponse> {
    const { data } = await this._http.post<KeycloakTokenResponse>(this._tokenPath, new URLSearchParams(payload).toString(), { signal })
    return data
  }

  /** Завершает Keycloak session. */
  public async logout(payload: Record<string, string>, signal?: AbortSignal): Promise<void> {
    await this._http.post(this._logoutPath, new URLSearchParams(payload).toString(), { signal })
  }

  /** Загружает OIDC userinfo текущей session. */
  public async getUserInfo(accessToken: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const { data } = await this._http.get<Record<string, unknown>>(this._userinfoPath, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    })
    return data
  }
}
