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
