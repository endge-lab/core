/** Date или строка даты в ISO-строку с окончанием Z (UTC). */
export function dateToIsoZ(value: unknown): string | null {
  if (value == null) return null
  let d: Date
  if (value instanceof Date) {
    d = value
  } else if (typeof value === 'string') {
    const s = value.trim()
    if (!s) return null
    d = new Date(s)
  } else {
    return null
  }
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}
