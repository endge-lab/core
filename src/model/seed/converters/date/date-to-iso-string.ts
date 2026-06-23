/** Date в ISO-строка (дата и время). */
export function dateToIsoString(value: unknown): string | null {
  if (value == null) return null
  if (!(value instanceof Date)) return null
  if (Number.isNaN(value.getTime())) return null
  return value.toISOString()
}
