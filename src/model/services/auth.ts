import type {KeycloakTokenResponse, StoredAuthToken} from '@/domain/types/auth/auth.types'
import type { AxiosInstance } from 'axios'

import axios from 'axios'
import qs from 'qs'

export function mapTokenResponseToStored(
  data: KeycloakTokenResponse,
  now: Date = new Date(),
): StoredAuthToken {
  const accessMs: number = (data.expires_in ?? 0) * 1000
  const refreshMs: number = (data.refresh_expires_in ?? 0) * 1000

  const accessExpiresAt: Date = new Date(now.getTime() + accessMs)
  const refreshExpiresAt: Date | undefined
    = data.refresh_expires_in != null ? new Date(now.getTime() + refreshMs) : undefined

  return {
    ...data,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    access_expires: accessExpiresAt.toISOString(),
    refresh_expires: refreshExpiresAt?.toISOString(),
  }
}

export class KeycloakAuthService {
  private readonly http: AxiosInstance
  private readonly tokenPath: string
  private readonly logoutPath: string

  public constructor(baseUrl: string, tokenPath: string, logoutPath: string) {
    this.http = axios.create({
      baseURL: baseUrl,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    this.tokenPath = tokenPath
    this.logoutPath = logoutPath
  }

  public async passwordGrant(payload: Record<string, string>): Promise<KeycloakTokenResponse> {
    const { data } = await this.http.post<KeycloakTokenResponse>(this.tokenPath, qs.stringify(payload))
    return data
  }

  public async refreshGrant(payload: Record<string, string>): Promise<KeycloakTokenResponse> {
    const { data } = await this.http.post<KeycloakTokenResponse>(this.tokenPath, qs.stringify(payload))
    return data
  }

  public async logout(payload: Record<string, string>): Promise<void> {
    await this.http.post(this.logoutPath, qs.stringify(payload))
  }

  /**
   * Получить userinfo для текущего токена.
   * ВАЖНО: сюда нужно передавать axios-инстанс с уже выставленным Authorization.
   */
  public async getUserInfo(authorizedHttp: AxiosInstance): Promise<any> {
    const baseUrl: string = this.http.defaults.baseURL ?? ''
    const url: string = baseUrl.endsWith('/')
      ? `${baseUrl}userinfo`
      : `${baseUrl}/userinfo`

    const { data } = await authorizedHttp.get(url)
    return data
  }
}
