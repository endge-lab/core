import type { SourceKind, SourceParseResult, SourcePatchResult, SourcePatchStrategy } from '@/modules/source/domain/types/source-engine.types'
import type { VocabSourceDocument, VocabSourcePatch } from '@/modules/source/domain/types/vocab-source.types'

import { parseVocabSource, patchVocabSource } from '@/modules/source/services/vocab-source-patch'

export class VocabSourcePatchStrategy implements SourcePatchStrategy<VocabSourcePatch, VocabSourceDocument> {
  public readonly id = 'source-patch:vocab'
  public readonly sourceKind: SourceKind = 'vocab'

  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  public parse(source: string): SourceParseResult<VocabSourceDocument> {
    return parseVocabSource(source)
  }

  public patch(source: string, patch: VocabSourcePatch): SourcePatchResult<VocabSourceDocument> {
    return patchVocabSource(source, patch)
  }
}
