import type {
  SourceEngineCompileResult,
  SourceEngineStrategy,
  SourceKind,
} from '@/domain/types/source-engine.types'

import { compileFilterSource } from '@/domain/services/source-engine/filter-source-compile'

/** Source strategy для RFilter/source-kind=filter. */
export class FilterSourceEngineStrategy implements SourceEngineStrategy {
  public readonly id = 'source:filter'
  public readonly sourceKind: SourceKind = 'filter'

  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  public compile(source: string): SourceEngineCompileResult {
    const result = compileFilterSource(source)
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return {
      ok,
      ast: result.ast ?? undefined,
      document: result.document ?? undefined,
      artifact: result.artifact ?? undefined,
      metadata: result.metadata,
      diagnostics: result.diagnostics,
      message: ok ? undefined : 'Filter source contains compilation errors.',
    }
  }
}
