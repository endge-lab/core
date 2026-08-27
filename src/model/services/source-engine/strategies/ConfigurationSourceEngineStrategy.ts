import type { SourceEngineCompileResult, SourceEngineStrategy, SourceKind } from '@/domain/types/source/source-engine.types'

import { compileConfigurationSource } from '@/model/services/source-engine/compilers/configuration-source-compile'

export class ConfigurationSourceEngineStrategy implements SourceEngineStrategy {
  readonly id = 'source:configuration'
  readonly sourceKind: SourceKind = 'configuration'

  supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  compile(source: string): SourceEngineCompileResult {
    const result = compileConfigurationSource(source)
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return {
      ok,
      ast: result.ast ?? undefined,
      document: result.document ?? undefined,
      artifact: result.document ?? undefined,
      diagnostics: result.diagnostics,
      message: ok ? undefined : 'Configuration source contains compilation errors.',
    }
  }
}
