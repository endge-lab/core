import type { SourceEngineCompileResult, SourceEngineStrategy, SourceKind } from '@/domain/types/source/source-engine.types'

import { compileComputation } from '@/model/services/compiler/computation/computation-compile'

export class ComputationSourceEngineStrategy implements SourceEngineStrategy {
  public readonly id = 'source:computation'
  public readonly sourceKind: SourceKind = 'computation'

  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  public compile(source: string): SourceEngineCompileResult {
    const result = compileComputation({ source, input: null, output: null })
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return {
      ok,
      document: result.payload.sourceDocument ?? undefined,
      artifact: result.payload,
      diagnostics: result.diagnostics,
      message: ok ? undefined : 'Computation source contains compilation errors.',
    }
  }
}
