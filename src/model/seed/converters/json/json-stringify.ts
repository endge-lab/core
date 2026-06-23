/** Объект в JSON-строку. */
export function jsonStringify(value: unknown): string | null {
  if (value === undefined) return null
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}
