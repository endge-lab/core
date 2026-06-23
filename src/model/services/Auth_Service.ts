import { EndgeApi, makeForm } from '@/domain/entities/endge/EndgeApi'
import type { KeycloakTokenResponse } from '@/domain/types/auth.types'

/**
 * Лёгкий клиент Keycloak-совместимого токен-эндпоинта.
 * Работает поверх EndgeApi (form-urlencoded).
 */
export class AuthService {
  constructor(
    private readonly api: EndgeApi,
    private readonly clientId: string,
    private readonly defaultScope: string = 'openid profile email',
  ) {}

  /** Удобная фабрика из конфигурации EndgeAuth. */
  static fromConfig(opts: {
    baseUrl: string
    clientId: string
    scope?: string
    headers?: Record<string, string>
  }) {
    const api = new EndgeApi(opts.baseUrl, {
      Accept: 'application/json',
      ...(opts.headers ?? {}),
    })
    return new AuthService(
      api,
      opts.clientId,
      opts.scope ?? 'openid profile email',
    )
  }

  /** Resource Owner Password Credentials (password grant). */
  generateJWT(username: string, password: string, scope?: string) {
    return this.api.post<KeycloakTokenResponse>(
      '/token',
      makeForm({
        username,
        password,
        client_id: this.clientId,
        grant_type: 'password',
        scope: scope ?? this.defaultScope,
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        rawBody: true,
      },
    )
  }

  refresh(refreshToken: string) {
    return this.api.post<KeycloakTokenResponse>(
      '/token',
      makeForm({
        client_id: this.clientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        rawBody: true,
      },
    )
  }

  logout(refreshToken: string) {
    return this.api.post<void>(
      '/logout',
      makeForm({
        client_id: this.clientId,
        refresh_token: refreshToken,
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        rawBody: true,
      },
    )
  }
}
