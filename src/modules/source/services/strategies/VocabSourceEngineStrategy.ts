import type {
  SourceEngineCompileResult,
  SourceEngineOperation,
  SourceEngineResult,
  SourceEngineStrategy,
  SourceKind,
} from '@/modules/source/domain/types/source-engine.types'

import { compileVocabSource } from '@/modules/source/services/compilers/vocab-source-compile'

export class VocabSourceEngineStrategy implements SourceEngineStrategy {
  public readonly id = 'source:vocab'
  public readonly sourceKind: SourceKind = 'vocab'

  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  public execute(_operation: SourceEngineOperation): SourceEngineResult {
    return { ok: false, message: 'Vocab source operations are not implemented yet.' }
  }

  public compile(source: string): SourceEngineCompileResult {
    const result = compileVocabSource(source)
    const ok = !result.diagnostics.some(diagnostic => diagnostic.severity === 'error')
    return {
      ok,
      ast: result.ast,
      document: result.document ?? undefined,
      artifact: result.artifact ?? undefined,
      metadata: result.metadata,
      diagnostics: result.diagnostics,
      message: ok ? undefined : 'Vocab source contains compilation errors.',
    }
  }
}
