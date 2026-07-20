import type {
  SourceEngineCompileResult,
  SourceEngineStrategy,
  SourceKind,
} from '@/domain/types/source/source-engine.types'

import { compileTypeSource } from '@/model/services/source-engine/compilers/type-source-compile'

/** Source strategy для RType/source-kind=type. */
export class TypeSourceEngineStrategy implements SourceEngineStrategy {
  public readonly id = 'source:type'
  public readonly sourceKind: SourceKind = 'type'

  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  public compile(source: string): SourceEngineCompileResult {
    const result = compileTypeSource(source)
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return {
      ok,
      ast: result.ast ?? undefined,
      document: result.document ?? undefined,
      artifact: result.artifact ?? undefined,
      diagnostics: result.diagnostics,
      message: ok ? undefined : 'Type source contains compilation errors.',
    }
  }
}
