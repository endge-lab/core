import type { SourceEngineCompileResult, SourceEngineStrategy, SourceKind } from '@/modules/source/domain/types/source-engine.types'

import { compileUpdateSource } from '@/modules/source/services/compilers/update-source-compile'

export class UpdateSourceEngineStrategy implements SourceEngineStrategy {
  public readonly id = 'source:update'
  public readonly sourceKind: SourceKind = 'update'

  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  public compile(source: string): SourceEngineCompileResult {
    const result = compileUpdateSource(source)
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return { ok, ast: result.ast ?? undefined, document: result.document ?? undefined, artifact: result.artifact ?? undefined, diagnostics: result.diagnostics, message: ok ? undefined : 'Update source contains compilation errors.' }
  }
}
