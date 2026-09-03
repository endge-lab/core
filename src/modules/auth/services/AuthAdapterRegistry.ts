import type { AuthProfileAdapter, AuthProfileSchema } from '@/modules/auth/domain/types/auth-profile.types'

/** Registry встроенных и plugin auth adapters. */
export class AuthAdapterRegistry {
  private readonly _adapters = new Map<string, AuthProfileAdapter>()

  /** Регистрирует adapter и запрещает неявную замену существующего id. */
  public register(adapter: AuthProfileAdapter): void {
    const id = String(adapter.id ?? '').trim()
    if (!id) {
      throw new Error('[EndgeAuth.adapters] adapter.id is required')
    }
    if (this._adapters.has(id)) {
      throw new Error(`[EndgeAuth.adapters] Adapter already registered: ${id}`)
    }
    this._adapters.set(id, adapter)
  }

  /** Возвращает adapter по id. */
  public get(id: string): AuthProfileAdapter | null {
    return this._adapters.get(String(id ?? '').trim()) ?? null
  }

  /** Требует зарегистрированный adapter для profile. */
  public require(profile: AuthProfileSchema): AuthProfileAdapter {
    const adapter = this.get(profile.adapterId)
    if (!adapter) {
      throw new Error(`[EndgeAuth] Unknown auth adapter: ${profile.adapterId}`)
    }
    return adapter
  }

  /** Проверяет profile его adapter-ом. */
  public validate(profile: AuthProfileSchema): void {
    this.require(profile).validate(profile)
  }
}
