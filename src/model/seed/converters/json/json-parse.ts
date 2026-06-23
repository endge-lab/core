/** JSON-строка в объект. */
export function jsonParse(value: unknown): unknown {
  if (value == null) return null
  const s = String(value).trim()
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
