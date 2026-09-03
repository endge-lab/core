import type { EndgePersistenceScope } from '@/modules/context/domain/context-persistence.types'

/** Глобальный ключ registry для всех экземпляров федерации Endge. */
export const ENDGE_FEDERATION_REGISTRY_KEY = Symbol.for('endge.federation.registry.v2')

export const DEFAULT_LOCALE = 'en'
export const DEFAULT_FALLBACK_LOCALE = 'en'
export const DEFAULT_THEME = 'dark'
export const DEFAULT_TIMEZONE = 'local'

export const DEFAULT_SCOPE = {
  tenantId: 'default',
  projectId: 'default',
  environmentId: 'dev',
  userId: 'anonymous',
} as const satisfies Omit<EndgePersistenceScope, 'workspaceId'>
