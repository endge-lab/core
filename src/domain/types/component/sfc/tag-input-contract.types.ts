import type { RComponentContractInput } from '@/domain/types/component/component-core.types'
import type { RComponentSFC_IR_Tag } from './ir.types'

/** Публичный входной параметр renderer-neutral встроенного SFC tag. */
export type ComponentSFCTagInputContract = Readonly<RComponentContractInput>

/**
 * Data-facing входы встроенных tags для source-aware visual editors.
 * Presentation-атрибуты остаются в отдельном редакторе атрибутов.
 */
export const ENDGE_SFC_TAG_INPUT_CONTRACTS = {
  Text: [
    { name: 'value', type: 'string', optional: true },
  ],
  DateTime: [
    { name: 'value', type: 'Date | string', optional: false },
    { name: 'format', type: 'string', optional: true },
    { name: 'timezone', type: 'string', optional: true },
    { name: 'empty', type: 'string', optional: true },
  ],
  Number: [
    { name: 'value', type: 'number', optional: false },
    { name: 'decimals', type: 'number', optional: true },
    { name: 'prefix', type: 'string', optional: true },
    { name: 'suffix', type: 'string', optional: true },
    { name: 'empty', type: 'string', optional: true },
  ],
  Icon: [
    { name: 'name', type: 'string', optional: false },
  ],
  Badge: [
    { name: 'value', type: 'string', optional: true },
    { name: 'tone', type: 'string', optional: true },
  ],
  Dot: [
    { name: 'tone', type: 'string', optional: true },
  ],
  Box: [],
  Flex: [],
  Grid: [],
  Divider: [
    { name: 'orientation', type: "'horizontal' | 'vertical'", optional: true },
  ],
  Input: [
    { name: 'value', type: 'unknown', optional: true },
    { name: 'type', type: "'String' | 'Number' | 'Date' | 'Time' | 'DateTime'", optional: true },
    { name: 'placeholder', type: 'string', optional: true },
    { name: 'min', type: 'string | number', optional: true },
    { name: 'max', type: 'string | number', optional: true },
    { name: 'step', type: 'string | number', optional: true },
    { name: 'readonly', type: 'boolean', optional: true },
    { name: 'disabled', type: 'boolean', optional: true },
  ],
  Textarea: [
    { name: 'value', type: 'string', optional: true },
    { name: 'rows', type: 'number', optional: true },
    { name: 'placeholder', type: 'string', optional: true },
    { name: 'readonly', type: 'boolean', optional: true },
    { name: 'disabled', type: 'boolean', optional: true },
  ],
  Checkbox: [
    { name: 'checked', type: 'boolean', optional: true },
    { name: 'label', type: 'string', optional: true },
    { name: 'readonly', type: 'boolean', optional: true },
    { name: 'disabled', type: 'boolean', optional: true },
  ],
  Select: [
    { name: 'value', type: 'unknown | unknown[]', optional: true },
    { name: 'options', type: 'SourceFieldOption[]', optional: false },
    { name: 'multiple', type: 'boolean', optional: true },
    { name: 'placeholder', type: 'string', optional: true },
    { name: 'readonly', type: 'boolean', optional: true },
    { name: 'disabled', type: 'boolean', optional: true },
  ],
} as const satisfies Partial<Record<RComponentSFC_IR_Tag, readonly ComponentSFCTagInputContract[]>>

/** Возвращает публичные data-входы встроенного SFC tag. */
export function getComponentSFCTagInputContract(
  tag: RComponentSFC_IR_Tag,
): readonly ComponentSFCTagInputContract[] {
  return ENDGE_SFC_TAG_INPUT_CONTRACTS[tag as keyof typeof ENDGE_SFC_TAG_INPUT_CONTRACTS] ?? []
}
