import type { RComponentSFC_SourceRange } from './location.types'
import type { RComponentDiagnostic } from '@/modules/domain/types/component/component-core.types'
import type { ProgramMetadataMap } from '@/modules/program/domain/types/program-metadata.types'

/** Source-backed read model of component-level defineMetadata. */
export interface ComponentSFCMetadataVisualProjection {
  mode: 'missing' | 'static' | 'invalid' | 'duplicate'
  editable: boolean
  metadata: ProgramMetadataMap
  json: string
  sourceRange: RComponentSFC_SourceRange | null
  message?: string
}

/** Result of replacing or inserting component-level defineMetadata. */
export interface ComponentSFCMetadataSourcePatchResult {
  ok: boolean
  source: string
  changed: boolean
  projection: ComponentSFCMetadataVisualProjection
  diagnostics: RComponentDiagnostic[]
  message?: string
}
