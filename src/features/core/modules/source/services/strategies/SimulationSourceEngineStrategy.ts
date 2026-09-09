import type { SimulationSourceCatalog } from '@/features/core/modules/source/domain/types/simulation-source.types'
import type { SourceEngineCompileResult, SourceEngineStrategy, SourceKind } from '@/features/core/modules/source/domain/types/source-engine.types'

import { compileSimulationSource } from '@/features/core/modules/source/services/compilers/simulation-source-compile'
import { SimulationSourceResolver } from '@/features/core/modules/source/services/SimulationSourceResolver'

export class SimulationSourceEngineStrategy implements SourceEngineStrategy {
  public readonly id = 'source:simulation'
  public readonly sourceKind: SourceKind = 'simulation'

  public constructor(private readonly _catalog: () => SimulationSourceCatalog) {}

  public supports(sourceKind: SourceKind | string): boolean { return sourceKind === this.sourceKind }

  public compile(source: string): SourceEngineCompileResult {
    const result = new SimulationSourceResolver(this._catalog()).analyze(compileSimulationSource(source))
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return { ok, ast: result.ast ?? undefined, document: result.document ?? undefined, artifact: result.artifact ?? undefined, diagnostics: result.diagnostics, dependencies: result.dependencies, message: ok ? undefined : 'Simulation source contains compilation errors.' }
  }
}
