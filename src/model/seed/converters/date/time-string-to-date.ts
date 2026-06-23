/** Строка времени HH:mm или HH:mm:ss в Date с текущей датой. */
export function timeStringToDate(value: unknown): Date | null {
  if (value == null) return null
  const s = String(value).trim()
  if (!s) return null
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return null
  const [h, m, sec = '0'] = s.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, Number(sec), 0)
  return d
}
