import type { RComponentSFC_SourceRange } from './location.types'
import type { RComponentDiagnostic } from '@/features/core/modules/domain/types/component/component-core.types'
import type { ProgramMetadataMap } from '@/features/core/modules/program/domain/types/program-metadata.types'

/** Read-модель defineMetadata уровня компонента на основе Source. */
export interface ComponentSFCMetadataVisualProjection {
  mode: 'missing' | 'static' | 'invalid' | 'duplicate'
  editable: boolean
  metadata: ProgramMetadataMap
  json: string
  sourceRange: RComponentSFC_SourceRange | null
  message?: string
}

/** Результат замены или вставки defineMetadata уровня компонента. */
export interface ComponentSFCMetadataSourcePatchResult {
  ok: boolean
  source: string
  changed: boolean
  projection: ComponentSFCMetadataVisualProjection
  diagnostics: RComponentDiagnostic[]
  message?: string
}
