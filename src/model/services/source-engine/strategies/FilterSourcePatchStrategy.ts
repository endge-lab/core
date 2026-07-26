import type {
  FilterSourceEditorDocument,
  FilterSourcePatch,
} from '@/domain/types/source/filter-source.types'
import type {
  SourceKind,
  SourceParseResult,
  SourcePatchResult,
  SourcePatchStrategy,
} from '@/domain/types/source/source-engine.types'

import {
  parseFilterSourceForEditor,
  patchFilterSource,
} from '@/model/services/source-engine/filter-source-patch'

/** Source patch strategy для RFilter/source-kind=filter. */
export class FilterSourcePatchStrategy implements SourcePatchStrategy<FilterSourcePatch, FilterSourceEditorDocument> {
  public readonly id = 'source-patch:filter'
  public readonly sourceKind: SourceKind = 'filter'

  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  public parse(source: string): SourceParseResult<FilterSourceEditorDocument> {
    return parseFilterSourceForEditor(source)
  }

  public patch(
    source: string,
    patch: FilterSourcePatch,
  ): SourcePatchResult<FilterSourceEditorDocument> {
    return patchFilterSource(source, patch)
  }
}
