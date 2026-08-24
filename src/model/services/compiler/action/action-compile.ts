import type { RAction } from '@/domain/entities/reflect/RAction'
import type { ActionProgramPayload, ProgramDependency, ProgramDiagnostic } from '@/domain/types/program/program.types'
import { normalizeActionTargets } from '@/model/services/compiler/action/action-target-validation'
import { compileActionSource } from '@/model/services/source-engine/compilers/action-source-compile'

export interface ActionCompileResult {
  payload: ActionProgramPayload
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
  dependencies: ProgramDependency[]
}

/** Compiles persisted Action Source into Program. */
export function compileAction(entity: RAction): ActionCompileResult {
  const diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[] = []
  let target = entity.target
  try {
    target = normalizeActionTargets(entity.target)
  }
  catch (error) {
    diagnostics.push({
      severity: 'error',
      code: (error as { code?: string }).code ?? 'action-target-invalid',
      message: error instanceof Error ? error.message : String(error),
      sourcePath: 'target',
    })
  }

  const source = compileActionSource({ source: entity.source, sourceVersion: entity.sourceVersion, target })
  return {
    payload: source.payload,
    diagnostics: [...diagnostics, ...source.diagnostics],
    dependencies: source.dependencies,
  }
}
