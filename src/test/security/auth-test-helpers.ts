import type { AuthProfileSchema, AuthTokenSet } from '@/domain/types/auth/auth-profile.types'

export class MemoryStorage implements Storage {
  private readonly _values = new Map<string, string>()
  public get length(): number { return this._values.size }
  public clear(): void { this._values.clear() }
  public getItem(key: string): string | null { return this._values.get(key) ?? null }
  public key(index: number): string | null { return [...this._values.keys()][index] ?? null }
  public removeItem(key: string): void { this._values.delete(key) }
  public setItem(key: string, value: string): void { this._values.set(key, value) }
}

export function authProfile(overrides: Partial<AuthProfileSchema> = {}): AuthProfileSchema {
  return {
    id: 'auth-main',
    identity: 'auth-main',
    name: 'Auth main',
    displayName: 'Auth main',
    adapterId: 'oidc',
    config: { issuer: 'https://issuer.example', clientId: 'web', scopes: ['openid', 'profile'] },
    credentials: {},
    session: { storage: 'localStorage', persistRefreshToken: false },
    active: true,
    ...overrides,
  }
}

export function tokenSet(overrides: Partial<AuthTokenSet> = {}): AuthTokenSet {
  return { accessToken: 'access-token', refreshToken: 'refresh-token', accessExpiresAt: 120_000, refreshExpiresAt: 240_000, ...overrides }
}
