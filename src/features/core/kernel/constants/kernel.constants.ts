import type { EndgePersistenceScope } from '@/features/core/modules/context/domain/context-persistence.types'

export const DEFAULT_LOCALE = 'en'
export const DEFAULT_FALLBACK_LOCALE = 'en'
export const DEFAULT_THEME = 'dark'
export const DEFAULT_TIMEZONE = 'local'

export const DEFAULT_SCOPE = {
  facetSelections: [],
  userId: 'anonymous',
} as const satisfies Omit<EndgePersistenceScope, 'workspaceId'>
