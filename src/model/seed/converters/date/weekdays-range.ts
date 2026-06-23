/**
 * Строка вида "1,2,3-5" (дни 1–7, диапазон через дефис) - массив из 7 boolean.
 * День 1 = index 0, день 7 = index 6.
 */
export function weekdaysRange(str: any): boolean[] {
  const result = Array(7).fill(false)
  const s = str != null ? String(str).trim() : ''
  if (!s) return result

  const parts = s.split(',').map((p: string) => p.trim())

  for (const part of parts) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number)
      for (let i = start; i <= end; i++) {
        if (i >= 1 && i <= 7) result[i - 1] = true
      }
    } else {
      const day = Number(part)
      if (day >= 1 && day <= 7) result[day - 1] = true
    }
  }

  return result
}
