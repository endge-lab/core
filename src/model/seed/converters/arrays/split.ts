/** Разбивает строку по запятой, trim каждого элемента. */
export function split(value: unknown): string[] {
  if (value == null) return []
  const s = String(value).trim()
  if (!s) return []
  return s.split(',').map(p => p.trim())
}
