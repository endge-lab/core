// Type expressions contain selected values plus compiler-only validation variants.
// This projection is used for execution dependencies; validation still visits all variants.
export function selectTypeContext<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => selectTypeContext(item)) as T
  }
  if (value == null || typeof value !== 'object') {
    return value
  }
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'contextVariants')
    .map(([key, item]) => [key, selectTypeContext(item)])) as T
}
