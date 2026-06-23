/** Date в строку времени HH:mm:ss. */
export function dateToTimeString(value: unknown): string | null {
  if (value == null) return null
  if (!(value instanceof Date)) return null
  if (Number.isNaN(value.getTime())) return null
  const h = String(value.getHours()).padStart(2, '0')
  const m = String(value.getMinutes()).padStart(2, '0')
  const s = String(value.getSeconds()).padStart(2, '0')
  return `${h}:${m}:${s}`
}
