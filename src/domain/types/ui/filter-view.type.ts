import type {
  SourceFieldDefinition,
  SourceFieldOption,
} from '@/domain/types/source/source-expression.types'

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
