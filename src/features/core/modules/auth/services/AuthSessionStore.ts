import type { AuthProfileSchema } from '@/features/core/modules/auth/domain/types/auth-profile.types'
import type { AuthSessionSnapshot } from '@/features/core/modules/auth/domain/types/auth-runtime.types'

/** Хранит versioned token snapshots согласно profile persistence policy. */
export class AuthSessionStore {
  private readonly _memory = new Map<string, AuthSessionSnapshot>()
  private _namespace = 'default'

  /** Устанавливает namespace, предоставленный host-приложением до restore/build. */
  public setNamespace(namespace: string | undefined): void {
    this._namespace = String(namespace ?? '').trim() || 'default'
  }

  /** Возвращает namespaced storage key для workspace/profile. */
  public getKey(workspaceIdentity: string, profileIdentity: string): string {
    return `endge:auth:v2:${encodeURIComponent(this._namespace)}:${encodeURIComponent(workspaceIdentity)}:${encodeURIComponent(profileIdentity)}`
  }

  /** Восстанавливает snapshot и удаляет повреждённое значение. */
  public read(workspaceIdentity: string, profile: AuthProfileSchema): AuthSessionSnapshot | null {
    const key = this.getKey(workspaceIdentity, profile.identity)
    const storagePolicy = profile.session?.storage ?? 'memory'
    if (storagePolicy === 'memory') {
      return this._memory.get(key) ?? null
    }

    const storage = this._storage(storagePolicy)
    if (!storage) {
      return null
    }
    try {
      const raw = storage.getItem(key)
      if (!raw) {
        return null
      }
      const snapshot = JSON.parse(raw)
      if (isAuthSessionSnapshot(snapshot, profile)) {
        return snapshot
      }
      storage.removeItem(key)
      return null
    }
    catch {
      try {
        storage.removeItem(key)
      }
      catch {
        // Недоступный browser storage означает anonymous session.
      }
      return null
    }
  }

  /** Сохраняет token snapshot без credentials и userinfo. */
  public write(workspaceIdentity: string, profile: AuthProfileSchema, snapshot: AuthSessionSnapshot): void {
    const key = this.getKey(workspaceIdentity, profile.identity)
    const sanitized = profile.session?.persistRefreshToken === true
      ? snapshot
      : { ...snapshot, token: { ...snapshot.token, refreshToken: undefined } }
    const storagePolicy = profile.session?.storage ?? 'memory'
    if (storagePolicy === 'memory') {
      this._memory.set(key, sanitized)
      return
    }
    const storage = this._storage(storagePolicy)
    if (!storage) {
      return
    }
    try {
      storage.setItem(key, JSON.stringify(sanitized))
    }
    catch {
      // Storage quota/privacy restrictions не должны ломать полученную session.
    }
  }

  /** Удаляет session из всех поддерживаемых storage. */
  public remove(workspaceIdentity: string, profileIdentity: string): void {
    const key = this.getKey(workspaceIdentity, profileIdentity)
    this._memory.delete(key)
    for (const storage of [this._storage('localStorage'), this._storage('sessionStorage')]) {
      try {
        storage?.removeItem(key)
      }
      catch {
        // Local cleanup остаётся best effort.
      }
    }
  }

  /** Очищает только memory sessions при reset lifecycle. */
  public resetRuntime(): void {
    this._memory.clear()
  }

  private _storage(persist: 'localStorage' | 'sessionStorage'): Storage | null {
    try {
      if (persist === 'localStorage') {
        return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
      }
      return typeof globalThis.sessionStorage === 'undefined' ? null : globalThis.sessionStorage
    }
    catch {
      return null
    }
  }
}

function isAuthSessionSnapshot(value: unknown, profile: AuthProfileSchema): value is AuthSessionSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const snapshot = value as Record<string, any>
  const token = snapshot.token
  return snapshot.version === 1
    && snapshot.profileIdentity === profile.identity
    && snapshot.adapterId === profile.adapterId
    && typeof snapshot.updatedAt === 'string'
    && token != null
    && typeof token === 'object'
    && typeof token.accessToken === 'string'
    && (token.accessExpiresAt === null || Number.isFinite(token.accessExpiresAt))
    && (token.refreshExpiresAt == null || Number.isFinite(token.refreshExpiresAt))
}
