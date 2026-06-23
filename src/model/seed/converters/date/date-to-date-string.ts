/** Date в строку только даты YYYY-MM-DD. */
export function dateToDateString(value: unknown): string | null {
  if (value == null) return null
  if (!(value instanceof Date)) return null
  if (Number.isNaN(value.getTime())) return null
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
