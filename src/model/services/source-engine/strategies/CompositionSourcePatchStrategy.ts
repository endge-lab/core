import type {
  CompositionSourceDocument,
  CompositionSourcePatch,
} from '@/domain/types/source/composition-source.types'
import type {
  SourceKind,
  SourceParseResult,
  SourcePatchResult,
  SourcePatchStrategy,
} from '@/domain/types/source/source-engine.types'

import {
  parseCompositionSource,
  patchCompositionSource,
} from '@/model/services/source-engine/composition-source-patch'

/** Source patch strategy для RComposition/source-kind=composition. */
export class CompositionSourcePatchStrategy implements SourcePatchStrategy<CompositionSourcePatch, CompositionSourceDocument> {
  public readonly id = 'source-patch:composition'
  public readonly sourceKind: SourceKind = 'composition'

  /** Проверяет, что strategy обслуживает Composition source. */
  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  /** Парсит Composition source в normalized document. */
  public parse(source: string): SourceParseResult<CompositionSourceDocument> {
    return parseCompositionSource(source)
  }

  /** Атомарно добавляет Composition dependencies. */
  public patch(
    source: string,
    patch: CompositionSourcePatch,
  ): SourcePatchResult<CompositionSourceDocument> {
    return patchCompositionSource(source, patch)
  }
}
