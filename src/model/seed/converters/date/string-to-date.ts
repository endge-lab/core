/** Строка в Date: YYYY-MM-DD, HH:mm(:ss), ISO и др. */
export function stringToDate(input: string | Date | null | undefined): Date | null {
  if (!input) return null
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input
  const dateStr = String(input).trim()
  if (!dateStr) return null

  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(dateStr)) {
    const [h, m, s = '0'] = dateStr.split(':').map(Number)
    const d = new Date()
    d.setHours(h, m, Number(s), 0)
    return d
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, day] = dateStr.split('-').map(Number)
    return new Date(y, m - 1, day)
  }

  const parsed = new Date(dateStr)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
