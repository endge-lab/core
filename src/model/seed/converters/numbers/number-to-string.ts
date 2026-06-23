/** Число в строку. */
export function numberToString(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'number') return null
  return String(value)
}
