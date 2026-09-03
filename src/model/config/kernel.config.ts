import type { EndgeMockProvider } from '@/domain/types/mock/mock-data.type'

export {
  DEFAULT_FALLBACK_LOCALE,
  DEFAULT_LOCALE,
  DEFAULT_SCOPE,
  DEFAULT_THEME,
  DEFAULT_TIMEZONE,
  ENDGE_FEDERATION_REGISTRY_KEY,
} from '@/domain/constants/kernel.constants'

export const ENDGE_COMPILER_VERSION = 'program-v2'

/** Стабильные scope groups для compiler spans. */
export const ENDGE_COMPILER_SPAN_GROUPS = {
  COMPONENTS: 'components',
  TYPES: 'types',
  ACTIONS: 'actions',
  CONVERTERS: 'converters',
  QUERIES: 'queries',
  RAPH: 'raph',
} as const

/** Runtime fallback limits для nested computation execution. */
export const ENDGE_COMPUTATION_MAX_CALL_DEPTH = 32
export const ENDGE_COMPUTATION_MAX_CALLS = 256

export const CONTEXT_STORAGE_KEY = 'endge:context:v1'
export const LEGACY_CONTEXT_STORAGE_KEY = 'EndgeContext_Module'
export const LEGACY_THEME_STORAGE_KEY = 'endge:theme'
export const LEGACY_TIMEZONE_STORAGE_KEY = 'endge:isLocalTime'

/** Built-in mock providers. Application-owned providers are registered at boot. */
export const ENDGE_CORE_MOCK_PROVIDERS: EndgeMockProvider[] = []

export const VARS_STORAGE_KEY = 'endge:vars'
export const AUTH_STORAGE_KEY = 'endge:auth'

/** Ключ в Raph-хранилище для глобальных переменных. */
export const STORAGE_VARS_KEY = 'vars'
/** Raph namespace containing persistent and volatile Endge context values. */
export const ENDGE_CONTEXT_RAPH_PATH = 'context'
export const ENDGE_KEYBOARD_CONTEXT_RAPH_PATH = `${ENDGE_CONTEXT_RAPH_PATH}.input.keyboard`

/** Обратная совместимость публичного API `Config`. */
export default {
  VARS_STORAGE_KEY,
  AUTH_STORAGE_KEY,
  STORAGE_VARS_KEY,
}
