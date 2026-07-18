export type ManagedBy = 'system' | 'integration' | 'user'

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
