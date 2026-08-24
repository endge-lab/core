import type { SourceEngineCompileResult, SourceEngineStrategy, SourceKind } from '@/domain/types/source/source-engine.types'
import { compileActionSource } from '@/model/services/source-engine/compilers/action-source-compile'

export class ActionSourceEngineStrategy implements SourceEngineStrategy {
  public readonly id = 'source:action'
  public readonly sourceKind: SourceKind = 'action'
  public supports(sourceKind: SourceKind | string): boolean { return sourceKind === this.sourceKind }
  public compile(source: string): SourceEngineCompileResult {
    const result = compileActionSource({ source })
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return { ok, document: result.payload.sourceDocument ?? undefined, artifact: result.payload, diagnostics: result.diagnostics, message: ok ? undefined : 'Action source contains compilation errors.' }
  }
}
