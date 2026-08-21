import type { VocabSourceDocument, VocabSourcePatch } from '@/domain/types/source/vocab-source.types'
import type { SourceKind, SourceParseResult, SourcePatchResult, SourcePatchStrategy } from '@/domain/types/source/source-engine.types'

import { parseVocabSource, patchVocabSource } from '@/model/services/source-engine/vocab-source-patch'

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
