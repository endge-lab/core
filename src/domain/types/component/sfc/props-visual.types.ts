import type { RComponentDiagnostic } from '@/domain/types/component/component-core.types'
import type { RComponentSFC_IR_Prop } from './ir.types'
import type { RComponentSFC_SourceRange } from './location.types'

/** Source-backed projection of the SFC public props contract for visual editors. */
export interface ComponentSFCPropsVisualProjection {
  mode: 'missing' | 'inline-type' | 'named-type' | 'runtime'
  editable: boolean
  props: RComponentSFC_IR_Prop[]
  sourceRange: RComponentSFC_SourceRange | null
  message?: string
}

/** Result of replacing the editable inline defineProps contract. */
export interface ComponentSFCPropsSourcePatchResult {
  ok: boolean
  source: string
  changed: boolean
  projection: ComponentSFCPropsVisualProjection
  diagnostics: RComponentDiagnostic[]
  message?: string
}
