/** Миллисекунды с эпохи в Date. */
export function timestampToDate(value: unknown): Date | null {
  if (value == null) return null
  const ms = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(ms)) return null
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d
}
