import type { SourceEngineCompileResult, SourceEngineStrategy, SourceKind } from '@/features/core/modules/source/domain/types/source-engine.types'

import { compileCompositionSource } from '@/features/core/modules/source/services/compilers/composition-source-compile'

export class CompositionSourceEngineStrategy implements SourceEngineStrategy {
  public readonly id = 'source:composition'
  public readonly sourceKind: SourceKind = 'composition'

  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  public compile(source: string): SourceEngineCompileResult {
    const result = compileCompositionSource(source)
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return {
      ok,
      ast: result.ast ?? undefined,
      document: result.document ?? undefined,
      artifact: result.artifact ?? undefined,
      metadata: result.metadata,
      diagnostics: result.diagnostics,
      message: ok ? undefined : 'Composition source contains compilation errors.',
    }
  }
}
