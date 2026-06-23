/** Удаление пробелов по краям строки. */
export function stringTrim(value: unknown): string | null {
  if (value == null) return null
  return String(value).trim()
}
