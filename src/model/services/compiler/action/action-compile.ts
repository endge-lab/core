import type { RAction } from '@/domain/entities/reflect/RAction'
import type { ActionProgramPayload, ProgramDiagnostic } from '@/domain/types/program/program.types'
import { normalizeActionTargets } from '@/model/services/compiler/action/action-target-validation'

export interface ActionCompileResult {
  payload: ActionProgramPayload
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
}

/** Compiles persisted Flow source and the semantic Action contract into Program. */
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

  const compiledFlow = entity.buildCompiledFlow()
  diagnostics.push(...compiledFlow.issues.map(issue => ({
    severity: 'error' as const,
    code: issue.code,
    message: issue.message,
    sourcePath: issue.nodeId ? `definition.nodes.${issue.nodeId}` : 'definition',
  })))

  return {
    payload: {
      compiledFlow,
      target,
      input: entity.input ? {
        type: entity.input.type,
        name: entity.input.name,
        isArray: entity.input.isArray === true,
        optional: entity.input.optional === true,
      } : null,
      output: entity.output ? {
        type: entity.output.type,
        name: entity.output.name,
        isArray: entity.output.isArray === true,
        optional: entity.output.optional === true,
      } : null,
      implementation: entity.defaultImplementation,
    },
    diagnostics,
  }
}
