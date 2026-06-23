/** Если null/undefined/"" - вернуть defaultValue (параметр). */
export function defaultIfEmpty(value: unknown, defaultValue?: unknown): unknown {
  if (value == null || value === '') return defaultValue ?? null
  return value
}
