import type { EndgeMockProvider } from '@/domain/types/mock/mock-data.type'
import type { EndgePersistenceScope } from '@/domain/types/runtime/context-persistence.types'

export const ENDGE_COMPILER_VERSION = 'program-v2'

/** Стабильные scope groups для compiler spans. */
export const ENDGE_COMPILER_SPAN_GROUPS = {
  COMPONENTS: 'components',
  TYPES: 'types',
  ACTIONS: 'actions',
  CONVERTERS: 'converters',
  QUERIES: 'queries',
  SSE: 'sse',
  RAPH: 'raph',
} as const

/** Runtime fallback limits для nested computation execution. */
export const ENDGE_COMPUTATION_MAX_CALL_DEPTH = 32
export const ENDGE_COMPUTATION_MAX_CALLS = 256

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

/** Глобальный ключ registry для всех экземпляров федерации Endge. */
export const ENDGE_FEDERATION_REGISTRY_KEY = Symbol.for('endge.federation.registry.v2')

/** Built-in mock providers. Application-owned providers are registered at boot. */
export const ENDGE_CORE_MOCK_PROVIDERS: EndgeMockProvider[] = []

export const DOMAIN_STORAGE_KEY = 'endge:domain'
export const VARS_STORAGE_KEY = 'endge:vars'
export const AUTH_STORAGE_KEY = 'endge:auth'

/** Ключ в Raph-хранилище для глобальных переменных. */
export const STORAGE_VARS_KEY = 'vars'

/** Обратная совместимость публичного API `Config`. */
export default {
  DOMAIN_STORAGE_KEY,
  VARS_STORAGE_KEY,
  AUTH_STORAGE_KEY,
  STORAGE_VARS_KEY,
}
