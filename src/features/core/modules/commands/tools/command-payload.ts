/** Проверяет строковый параметр команды; нормализация значения остаётся у владельца операции. */
export function readCommandString(payload: unknown, field: string): string {
  const value = readCommandNullableString(payload, field)
  if (value === null) {
    throw new Error(`[Endge Commands] "${field}" must be a string`)
  }
  return value
}

/** Читает обязательную строку или явный null без приведения других типов. */
export function readCommandNullableString(payload: unknown, field: string): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Object.hasOwn(payload, field)) {
    throw new Error(`[Endge Commands] Payload must contain "${field}"`)
  }
  const value = (payload as Record<string, unknown>)[field]
  if (value !== null && typeof value !== 'string') {
    throw new Error(`[Endge Commands] "${field}" must be a string or null`)
  }
  return value
}
