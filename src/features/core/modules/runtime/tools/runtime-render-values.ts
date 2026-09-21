import type { VocabOptionMapping } from '@/features/core/modules/runtime/domain/vocab-cache.types'
import type { SourceFieldOption } from '@/features/core/modules/source/domain/types/source-expression.types'

/** Преобразование уже загруженного Vocab не требует его runtime или сетевого запроса. */
export function resolveRuntimeVocabOptions(values: unknown, mapping?: Partial<VocabOptionMapping>): SourceFieldOption[] {
  if (!Array.isArray(values)) {
    return []
  }
  const valuePath = String(mapping?.valuePath ?? 'value').trim()
  const labelPath = String(mapping?.labelPath ?? 'label').trim()
  if (!valuePath || !labelPath) {
    throw new Error('Vocab requires non-empty valuePath and labelPath.')
  }
  const read = (value: unknown, path: string): unknown => path.split('.').filter(Boolean).reduce<unknown>((current, key) => current !== null && typeof current === 'object' && Object.hasOwn(current, key) ? (current as Record<string, unknown>)[key] : undefined, value)
  return values.flatMap((item): SourceFieldOption[] => {
    const value = read(item, valuePath)
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      return []
    }
    const label = read(item, labelPath)
    return [{ value, label: label == null ? String(value) : String(label) }]
  })
}
