import type {
  AuthProfileAdapterId,
  AuthProfileConfig,
  AuthProfileCredentialRefs,
  AuthProfilePersist,
} from '@/domain/types/auth-profile.types'

import { Serialize } from '@endge/utils'
import { Expose } from 'class-transformer'

import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'
import { REntity } from '@/domain/entities/reflect/REntity'

export class RAuthProfile extends REntity {
  @Expose()
  displayName: string = ''

  @Expose()
  override description: string | null = null

  @Expose()
  adapterId: AuthProfileAdapterId = 'manual_token'

  @Expose()
  config: AuthProfileConfig = {}

  @Expose()
  credentialRefs: AuthProfileCredentialRefs = {}

  @Expose()
  persist: AuthProfilePersist = 'localStorage'

  @Expose()
  override active: boolean = true

  static fromPayload(raw: any): RAuthProfile {
    const profile = new RAuthProfile()
    profile.id = raw.id
    profile.identity = raw.identity ?? ''
    profile.name = raw.displayName ?? raw.identity ?? ''
    profile.displayName = raw.displayName ?? profile.name
    profile.description = raw.description ?? null
    profile.adapterId = normalizeAdapterId(raw.adapterId)
    profile.config = normalizeObject(raw.config)
    profile.credentialRefs = normalizeStringObject(raw.credentialRefs)
    profile.persist = normalizePersist(raw.persist)
    profile.folderId = raw.folder?.id ?? raw.folder ?? null
    profile.active = raw.active !== false
    profile.applyStorageMeta(raw)
    return profile
  }

  static fromPlain(raw: any): RAuthProfile {
    const profile = new RAuthProfile()
    profile.id = raw.id
    profile.identity = raw.identity ?? ''
    profile.name = raw.name ?? raw.displayName ?? raw.identity ?? ''
    profile.displayName = raw.displayName ?? profile.name
    profile.description = raw.description ?? null
    profile.adapterId = normalizeAdapterId(raw.adapterId)
    profile.config = normalizeObject(raw.config)
    profile.credentialRefs = normalizeStringObject(raw.credentialRefs)
    profile.persist = normalizePersist(raw.persist)
    profile.folderId = raw.folderId ?? raw.folder ?? null
    profile.active = raw.active !== false
    profile.deletedAt = raw.deletedAt ?? null
    profile.meta = normalizeObject(raw.meta)
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
      credentialRefs: this.credentialRefs ?? {},
      persist: this.persist ?? 'localStorage',
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
  if (id === 'keycloak_manual' || id === 'keycloak_form' || id === 'manual_token')
    return id
  return 'manual_token'
}

function normalizePersist(value: unknown): AuthProfilePersist {
  const persist = String(value ?? '').trim()
  if (persist === 'localStorage' || persist === 'sessionStorage' || persist === 'memory')
    return persist
  return 'localStorage'
}

function normalizeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

function normalizeStringObject(value: unknown): Record<string, string | undefined> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return {}
  const out: Record<string, string | undefined> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>))
    out[key] = raw == null ? undefined : String(raw)
  return out
}
