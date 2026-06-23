/** Строка в число (parseFloat). */
export function stringToNumber(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return Number.isNaN(value) ? null : value
  const n = parseFloat(String(value).trim())
  return Number.isNaN(n) ? null : n
}
