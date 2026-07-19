export type ManagedBy = 'system' | 'integration' | 'user'

/** Stable domain reference that never depends on a database identifier. */
export interface EntityRef {
  type: string
  identity: string
}

/**
 * Provenance of an entity in the effective domain read-model.
 * Only storage entities participate in persistence and export operations.
 */
export type EntityOrigin
  = | { kind: 'storage' }
    | { kind: 'builtin', owner: string }
    | { kind: 'local', owner: string }
    | { kind: 'derived', source: EntityRef }

export function isPersistedEntityOrigin(origin: EntityOrigin | null | undefined): boolean {
  return origin?.kind === 'storage'
}

export interface EntityManagement {
  managedBy: ManagedBy
  managedById: string | null
}

export type EntityManagementLike = Partial<EntityManagement> | null | undefined

export function normalizeEntityManagement(value: EntityManagementLike): EntityManagement {
  const managedBy: ManagedBy = value?.managedBy === 'system' || value?.managedBy === 'integration'
    ? value.managedBy
    : 'user'

  return {
    managedBy,
    managedById: managedBy === 'integration' && typeof value?.managedById === 'string'
      ? value.managedById.trim() || null
      : null,
  }
}

export function isSystemManaged(value: EntityManagementLike): boolean {
  return value?.managedBy === 'system'
}

export function isIntegrationManaged(value: EntityManagementLike): boolean {
  return value?.managedBy === 'integration'
}

export function isUserManaged(value: EntityManagementLike): boolean {
  return value?.managedBy === 'user'
}

export function isExternallyManaged(value: EntityManagementLike): boolean {
  return isSystemManaged(value) || isIntegrationManaged(value)
}
