import type { EndgePersistenceScope } from '@/domain/types/runtime/context-persistence.types'

export const CONTEXT_STORAGE_KEY = 'endge:context:v1'
export const LEGACY_CONTEXT_STORAGE_KEY = 'endge-context'
export const LEGACY_THEME_STORAGE_KEY = 'endge:theme'

export const DEFAULT_LOCALE = 'en'
export const DEFAULT_FALLBACK_LOCALE = 'en'
export const DEFAULT_THEME = 'dark'

export const DEFAULT_SCOPE = {
  tenantId: 'default',
  projectId: 'default',
  environmentId: 'dev',
  userId: 'anonymous',
} as const satisfies Omit<EndgePersistenceScope, 'workspaceId'>
