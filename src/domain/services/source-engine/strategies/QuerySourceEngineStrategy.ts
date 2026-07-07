import type {
  SourceEngineCompileResult,
  SourceEngineGenerateResult,
  SourceEngineOperation,
  SourceEngineResult,
  SourceEngineStrategy,
  SourceKind,
} from '@/domain/types/source-engine.types'

import { RQuery } from '@/domain/entities/reflect/RQuery'
import { compileQuerySource } from '@/domain/services/source-engine/query-source-compile'
import { generateQuerySource } from '@/domain/services/source-engine/query-source-generate'

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

  /** Генерирует query source v1 из persisted/legacy RQuery. */
  public generate(model: unknown): SourceEngineGenerateResult {
    if (!(model instanceof RQuery)) {
      return {
        ok: false,
        message: 'Query source generation expects RQuery model.',
      }
    }

    const result = generateQuerySource(model)
    return {
      ok: true,
      source: result.source,
      document: result.document,
    }
  }

  /** Компилирует query source v1 в canonical document и artifact payload. */
  public compile(source: string): SourceEngineCompileResult {
    const result = compileQuerySource(source)
    const ok = !result.diagnostics.some(diagnostic => diagnostic.severity === 'error')

    return {
      ok,
      ast: result.ast,
      document: result.document ?? undefined,
      artifact: result.artifact ?? undefined,
      diagnostics: result.diagnostics,
      message: ok ? undefined : 'Query source contains compilation errors.',
    }
  }
}
