import type {
  ComponentSFCMetadataSourcePatchResult,
  ComponentSFCMetadataVisualProjection,
} from '@/features/core/modules/domain/types/component/sfc/metadata-visual.types'
import type { ProgramMetadataMap } from '@/features/core/modules/program/domain/types/program-metadata.types'

import { inspectDocumentMetadata, patchDocumentMetadata } from '@/features/core/modules/domain/documents/document-metadata'
import { ComponentType } from '@/features/core/modules/domain/types/document/document.types'

/** Совместимый фасад старого SFC API над общим descriptor-driven metadata contract. */
export function inspectComponentSFCMetadata(source: string): ComponentSFCMetadataVisualProjection {
  const result = inspectDocumentMetadata(ComponentType.SFC, { source })
  return {
    mode: result.mode,
    editable: result.editable,
    metadata: result.metadata,
    json: result.json,
    sourceRange: result.sourceRange,
    ...(result.message ? { message: result.message } : {}),
  }
}

/** Совместимый фасад старого SFC patch API над общим descriptor-driven metadata contract. */
export function patchComponentSFCMetadataSource(
  source: string,
  metadata: ProgramMetadataMap,
): ComponentSFCMetadataSourcePatchResult {
  const result = patchDocumentMetadata(ComponentType.SFC, { source }, metadata)
  return {
    ok: result.ok,
    source: result.source,
    changed: result.changed,
    projection: inspectComponentSFCMetadata(result.source),
    diagnostics: result.diagnostics,
    ...(result.message ? { message: result.message } : {}),
  }
}
