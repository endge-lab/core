import type {
  SourceEngineCompileResult,
  SourceEngineOperation,
  SourceEngineResult,
  SourceEngineStrategy,
  SourceKind,
} from '@/domain/types/source-engine.types'

import { compileQuerySource } from '@/domain/services/source-engine/query-source-compile'

/** Source strategy для RQuery/source-kind=query. */
export class QuerySourceEngineStrategy implements SourceEngineStrategy {
  public readonly id = 'source:query'
  public readonly sourceKind: SourceKind = 'query'

  /** Проверяет, что стратегия обслуживает query source. */
  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  /** Заглушка будущего analyze/patch API, чтобы strategy уже имела стабильный контракт. */
  public execute(_operation: SourceEngineOperation): SourceEngineResult {
    return {
      ok: false,
      message: 'Query source operations are not implemented yet.',
    }
  }

  /** Компилирует source-only Query v2 в canonical document и artifact payload. */
  public compile(source: string): SourceEngineCompileResult {
    const result = compileQuerySource(source)
    const ok = !result.diagnostics.some(diagnostic => diagnostic.severity === 'error')

    return {
      ok,
      ast: result.ast,
      document: result.document ?? undefined,
      artifact: result.artifact ?? undefined,
      metadata: result.metadata,
      diagnostics: result.diagnostics,
      message: ok ? undefined : 'Query source contains compilation errors.',
    }
  }
}
