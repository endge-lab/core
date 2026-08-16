import type {
  SourceFieldDefinition,
  SourceFieldOption,
} from '@/domain/types/source/source-expression.types'

export const ENDGE_UI_SELECT_METADATA_NAMESPACE = 'endge.ui.select'
export const FILTER_SELECT_AUTO_OPTIMIZE_THRESHOLD = 10

/** Presentation hints встроенного Select; неизвестные metadata adapters игнорируют. */
export interface FilterSelectPresentationMetadata {
  searchable?: boolean
}

/** Результат применения metadata и безопасных adapter defaults к Select. */
export interface FilterSelectPresentation {
  searchable: boolean
  virtualized: boolean
}

/** Применяет явный searchable override и автоматическую оптимизацию больших списков. */
export function resolveFilterSelectPresentation(
  field: Pick<SourceFieldDefinition, 'metadata'>,
  optionCount: number,
): FilterSelectPresentation {
  const namespace = field.metadata?.[ENDGE_UI_SELECT_METADATA_NAMESPACE]
  const rawSearchable = isFilterSelectPresentationMetadata(namespace)
    ? namespace.searchable
    : undefined
  const searchable = typeof rawSearchable === 'boolean' ? rawSearchable : undefined
  const autoOptimize = optionCount > FILTER_SELECT_AUTO_OPTIMIZE_THRESHOLD

  return {
    searchable: searchable ?? autoOptimize,
    virtualized: autoOptimize,
  }
}

function isFilterSelectPresentationMetadata(value: unknown): value is FilterSelectPresentationMetadata {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

/** Renderer-neutral primitive, выбранный для поля Filter view. */
export type FilterViewControlType = 'Input' | 'Textarea' | 'Checkbox' | 'Select'

/** Явное переопределение автоматически выбранного контрола. */
export interface FilterViewControlDefinition {
  type: FilterViewControlType
}

/** Стабильные props, которые понимает встроенный Filter view generator. */
export interface FilterViewBuiltinProps {
  showLabels?: boolean
  labels?: Record<string, string>
}

/** Способ отображения Filter view. */
export type FilterViewImplementation
  = | { kind: 'generated' }
    | { kind: 'component', identity: string }

/** Одно поле готового renderer-neutral плана Filter view. */
export interface FilterViewRenderField extends SourceFieldDefinition {
  control: FilterViewControlDefinition
  value: unknown
  options: SourceFieldOption[]
}

/** Готовый renderer-neutral план Filter view. */
export interface FilterViewRenderModel {
  implementation: FilterViewImplementation
  /** Открытый user-defined props bag для встроенного или пользовательского renderer-а. */
  props: Readonly<Record<string, unknown>>
  fields: FilterViewRenderField[]
}
