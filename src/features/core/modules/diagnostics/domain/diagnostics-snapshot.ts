import type { DiagnosticsJsonValue } from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'

const REDACTED_VALUE = '[REDACTED]'
const CIRCULAR_VALUE = '[Circular]'
const SENSITIVE_KEY_PARTS = [
  'authorization',
  'cookie',
  'credential',
  'password',
  'passwd',
  'secret',
  'token',
  'dsn',
  'privatekey',
  'apikey',
  'accesskey',
]

export interface DiagnosticsJsonSerializationResult {
  value: DiagnosticsJsonValue
  redactedFields: number
}

/** Преобразует произвольное состояние в JSON-safe диагностическую проекцию с редактированием секретов. */
export function serializeDiagnosticsJson(input: unknown): DiagnosticsJsonSerializationResult {
  const ancestors = new WeakSet<object>()
  let redactedFields = 0

  const visit = (value: unknown, key?: string): DiagnosticsJsonValue | undefined => {
    if (key && isSensitiveKey(key)) {
      redactedFields += 1
      return REDACTED_VALUE
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      return value
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : String(value)
    }
    if (typeof value === 'bigint') {
      return value.toString()
    }
    if (typeof value !== 'object') {
      return undefined
    }
    if (value instanceof Date) {
      return value.toISOString()
    }
    if (ancestors.has(value)) {
      return CIRCULAR_VALUE
    }

    ancestors.add(value)
    try {
      if (Array.isArray(value)) {
        return value.map(item => visit(item) ?? null)
      }

      const result: Record<string, DiagnosticsJsonValue> = {}
      for (const [childKey, childValue] of Object.entries(value)) {
        const serialized = visit(childValue, childKey)
        if (serialized !== undefined) {
          result[childKey] = serialized
        }
      }
      return result
    }
    finally {
      ancestors.delete(value)
    }
  }

  return {
    value: visit(input) ?? null,
    redactedFields,
  }
}

/** Проверяет normalized key без зависимости от регистра и разделителей. */
function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return SENSITIVE_KEY_PARTS.some(part => normalized.includes(part))
}
