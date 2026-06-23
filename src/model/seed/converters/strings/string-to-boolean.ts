/** "true", "1" и т.п. в true; иначе false. */
export function stringToBoolean(value: unknown): boolean {
  if (value == null) return false
  const s = String(value).trim().toLowerCase()
  return s === 'true' || s === '1' || s === 'yes'
}
