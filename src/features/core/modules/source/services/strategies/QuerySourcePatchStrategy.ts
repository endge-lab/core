import type {
  QuerySourceDocument,
  QuerySourcePatch,
} from '@/features/core/modules/source/domain/types/query-source.types'
import type {
  SourceKind,
  SourceParseResult,
  SourcePatchResult,
  SourcePatchStrategy,
} from '@/features/core/modules/source/domain/types/source-engine.types'

import {
  parseQuerySource,
  patchQuerySource,
} from '@/features/core/modules/source/services/query-source-patch'

/** Source patch strategy для RQuery/source-kind=query. */
export class QuerySourcePatchStrategy implements SourcePatchStrategy<QuerySourcePatch, QuerySourceDocument> {
  public readonly id = 'source-patch:query'
  public readonly sourceKind: SourceKind = 'query'

  /** Проверяет, что стратегия обслуживает query source. */
  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  /** Парсит query source в normalized document для editor projections. */
  public parse(source: string): SourceParseResult<QuerySourceDocument> {
    return parseQuerySource(source)
  }

  /** Патчит query source по editor-slot операции. */
  public patch(source: string, patch: QuerySourcePatch): SourcePatchResult<QuerySourceDocument> {
    return patchQuerySource(source, patch)
  }
}
