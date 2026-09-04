import type { SourceEngineCompileResult, SourceEngineStrategy, SourceKind } from '@/features/core/modules/source/domain/types/source-engine.types'

import { compileStreamSource } from '@/features/core/modules/source/services/compilers/stream-source-compile'

export class StreamSourceEngineStrategy implements SourceEngineStrategy {
  public readonly id = 'source:stream'
  public readonly sourceKind: SourceKind = 'stream'

  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  public compile(source: string): SourceEngineCompileResult {
    const result = compileStreamSource(source)
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return { ok, ast: result.ast ?? undefined, document: result.document ?? undefined, artifact: result.artifact ?? undefined, diagnostics: result.diagnostics, message: ok ? undefined : 'Stream source contains compilation errors.' }
  }
}
