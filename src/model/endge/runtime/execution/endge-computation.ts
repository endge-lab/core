import type { ComputationProgramPayload, ProgramArtifact } from '@/domain/types/program/program.types'

import { Endge } from '@/model/endge/kernel/endge'
import { evaluateSourceExpression } from '@/model/services/source-engine/source-expression-evaluate'

/** Executes compiled synchronous computations from Endge.program. */
export class EndgeComputation {
  /** Resolves an artifact by id/identity and executes it with one input. */
  public run(idOrIdentity: string | number, input: unknown): unknown {
    const artifact = Endge.program.getComputationArtifact(idOrIdentity)
    if (!artifact)
      throw new Error(`Computation artifact "${String(idOrIdentity)}" is missing.`)
    return this.runArtifact(artifact, input)
  }

  /** Executes safe expression IR from an already resolved computation artifact. */
  public runArtifact(
    artifact: ProgramArtifact<ComputationProgramPayload>,
    input: unknown,
  ): unknown {
    if (artifact.status === 'error')
      throw new Error(`Computation "${artifact.ref.identity}" contains compile errors.`)
    if (!artifact.payload.expression)
      throw new Error(`Computation "${artifact.ref.identity}" has no executable expression.`)
    return evaluateSourceExpression(artifact.payload.expression, { scope: input })
  }
}
