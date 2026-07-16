import type { SourceEngineCompileResult, SourceEngineStrategy, SourceKind } from '@/domain/types/source/source-engine.types'

import { compileEndgeCSS } from '@/model/services/style'

export class StyleSourceEngineStrategy implements SourceEngineStrategy {
  public readonly id = 'source:style'
  public readonly sourceKind: SourceKind = 'style'

  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  public compile(source: string): SourceEngineCompileResult {
    const result = compileEndgeCSS(source)
    const ok = result.artifact !== null
    return {
      ok,
      ast: result.ast ?? undefined,
      document: result.ast ?? undefined,
      artifact: result.artifact ?? undefined,
      diagnostics: result.diagnostics,
      message: ok ? undefined : 'EndgeCSS source contains compilation errors.',
    }
  }
}
