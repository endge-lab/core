import type {
  SourceEngineCompileResult,
  SourceEngineOperation,
  SourceEngineResult,
  SourceEngineStrategy,
  SourceKind,
} from '@/domain/types/source-engine.types'

import { compileDataViewSource } from '@/domain/services/source-engine/data-view-source-compile'

/** Source strategy для RDataView/source-kind=data-view. */
export class DataViewSourceEngineStrategy implements SourceEngineStrategy {
  public readonly id = 'source:data-view'
  public readonly sourceKind: SourceKind = 'data-view'

  /** Проверяет, что strategy обслуживает DataView source. */
  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  /** Заглушка будущего analyze/patch API для DataView source. */
  public execute(_operation: SourceEngineOperation): SourceEngineResult {
    return {
      ok: false,
      message: 'DataView source operations are not implemented yet.',
    }
  }

  /** Компилирует DataView source v1 в canonical document и artifact payload. */
  public compile(source: string): SourceEngineCompileResult {
    const result = compileDataViewSource(source)
    const ok = !result.diagnostics.some(diagnostic => diagnostic.severity === 'error')

    return {
      ok,
      ast: result.ast,
      document: result.document ?? undefined,
      artifact: result.artifact ?? undefined,
      diagnostics: result.diagnostics,
      message: ok ? undefined : 'DataView source contains compilation errors.',
    }
  }
}
