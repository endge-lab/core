import type { RComponentDiagnostic } from '@/domain/types/component/component-core.types'
import type { ProgramMetadataMap } from '@/domain/types/program/program-metadata.types'
import type { RComponentSFC_SourceRange } from './location.types'

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
