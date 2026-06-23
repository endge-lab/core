/** ISO-строка в время HH:mm:ss. */
export function isoStringToTimeString(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  const sec = String(d.getSeconds()).padStart(2, '0')
  return `${h}:${m}:${sec}`
}
