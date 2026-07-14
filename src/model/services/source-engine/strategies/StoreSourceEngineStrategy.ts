import type { SourceEngineCompileResult, SourceEngineStrategy, SourceKind } from '@/domain/types/source-engine.types'

import { compileStoreSource } from '@/model/services/source-engine/store-source-compile'

export class StoreSourceEngineStrategy implements SourceEngineStrategy {
  public readonly id = 'source:store'
  public readonly sourceKind: SourceKind = 'store'

  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  public compile(source: string): SourceEngineCompileResult {
    const result = compileStoreSource(source)
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return { ok, ast: result.ast ?? undefined, document: result.document ?? undefined, artifact: result.artifact ?? undefined, diagnostics: result.diagnostics, message: ok ? undefined : 'Store source contains compilation errors.' }
  }
}
