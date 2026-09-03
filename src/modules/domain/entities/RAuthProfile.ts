import type {
  AuthProfileAdapterId,
  AuthProfileConfig,
  AuthProfileCredentials,
  AuthSessionPolicy,
} from '@/modules/auth/domain/types/auth-profile.types'

import type { DuplicateOptions } from '@/modules/domain/entities/REntity'
import { Serialize } from '@endge/utils'

import { Expose } from 'class-transformer'
import { REntity } from '@/modules/domain/entities/REntity'

export class RAuthProfile extends REntity {
  @Expose()
  displayName: string = ''

  @Expose()
  override description: string | null = null

  @Expose()
  adapterId: AuthProfileAdapterId = 'bearer'

  @Expose()
  config: AuthProfileConfig = {}

  @Expose()
  credentials: AuthProfileCredentials = {}

  @Expose()
  session: AuthSessionPolicy | undefined = undefined

  @Expose()
  override active: boolean = true

  static fromPlain(raw: any): RAuthProfile {
    const profile = new RAuthProfile()
    profile.id = raw.id
    profile.identity = raw.identity ?? ''
    profile.name = raw.name ?? raw.displayName ?? raw.identity ?? ''
    profile.displayName = raw.displayName ?? profile.name
    profile.description = raw.description ?? null
    profile.adapterId = normalizeAdapterId(raw.adapterId)
    profile.config = normalizeObject(raw.config)
    profile.credentials = normalizeStringObject(raw.credentials)
    profile.session = normalizeSession(raw.session)
    profile.folderId = raw.folderId ?? raw.folder ?? null
    profile.active = raw.active !== false
    profile.deletedAt = raw.deletedAt ?? null
    profile.applyEntityMeta(raw)
    return profile
  }

  toPlain(): Record<string, unknown> {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      displayName: this.displayName,
      description: this.description ?? null,
      adapterId: this.adapterId,
      config: this.config ?? {},
      credentials: this.credentials ?? {},
      ...(this.session ? { session: this.session } : {}),
      folderId: this.folderId ?? null,
      active: this.active !== false,
      deletedAt: this.deletedAt ?? null,
      meta: this.meta ?? {},
    }
  }

  override duplicate(options: DuplicateOptions): RAuthProfile {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return RAuthProfile.fromPlain(plain)
  }
}

function normalizeAdapterId(value: unknown): AuthProfileAdapterId {
  const id = String(value ?? '').trim()
  if (!id) {
    throw new Error('[RAuthProfile] adapterId is required')
  }
  return id
}

function normalizeSession(value: unknown): AuthSessionPolicy | undefined {
  if (value == null) {
    return undefined
  }
  const raw = normalizeObject(value)
  const storage = String(raw.storage ?? '').trim()
  if (storage !== 'localStorage' && storage !== 'sessionStorage' && storage !== 'memory') {
    throw new Error(`[RAuthProfile] Unsupported session storage: ${storage || '<empty>'}`)
  }
  if (typeof raw.persistRefreshToken !== 'boolean') {
    throw new TypeError('[RAuthProfile] session.persistRefreshToken must be boolean')
  }
  return { storage, persistRefreshToken: raw.persistRefreshToken }
}

function normalizeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

function normalizeStringObject(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    out[key] = raw == null ? '' : String(raw)
  }
  return out
}
