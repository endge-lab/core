import type { RComponentSFC_IR_Prop } from './ir.types'
import type { RComponentSFC_SourceRange } from './location.types'
import type { RComponentDiagnostic } from '@/modules/domain/types/component/component-core.types'

/** Основанная на Source проекция публичного контракта props SFC для визуальных редакторов. */
export interface ComponentSFCPropsVisualProjection {
  mode: 'missing' | 'inline-type' | 'named-type' | 'runtime'
  editable: boolean
  props: RComponentSFC_IR_Prop[]
  sourceRange: RComponentSFC_SourceRange | null
  message?: string
}

/** Результат замены редактируемого inline-контракта defineProps. */
export interface ComponentSFCPropsSourcePatchResult {
  ok: boolean
  source: string
  changed: boolean
  projection: ComponentSFCPropsVisualProjection
  diagnostics: RComponentDiagnostic[]
  message?: string
}
