import type {
  ComputationExecutionApi,
  ComputationProgramPayload,
  ComputationSandboxAdapter,
} from '@/domain/types/computation'
import type { ProgramArtifact } from '@/domain/types/program/program.types'

import { Endge } from '@/model/endge/kernel/endge'
import { evaluateSourceExpression } from '@/model/services/source-engine/source-expression-evaluate'

import { ComputationGraphExecutor, ComputationRuntimeError } from './ComputationGraphExecutor'
import { ComputationResourceState } from './ComputationResource'

/** Executes compiled computation graphs and creates renderer-neutral resources. */
export class EndgeComputation {
  private sandbox: ComputationSandboxAdapter | null = null
  private readonly executor = new ComputationGraphExecutor(() => this.sandbox)
  private readonly api: ComputationExecutionApi = {
    evaluate: (expression, scope) => evaluateSourceExpression(expression, { scope }),
  }

  public setSandboxAdapter(adapter: ComputationSandboxAdapter | null): void {
    this.sandbox?.dispose?.()
    this.sandbox = adapter
  }

  public async run(idOrIdentity: string | number, input: unknown): Promise<unknown> {
    const directOverride = typeof idOrIdentity === 'string'
      ? Endge.bind.getComputation(idOrIdentity)
      : null
    if (directOverride)
      return this.runOverride(idOrIdentity, directOverride, input)

    const artifact = this.requireArtifact(idOrIdentity)
    const identity = artifact.ref.identity
    const override = Endge.bind.getComputation(identity)
    if (override)
      return this.runOverride(identity, override, input)
    return this.runArtifact(artifact, input)
  }

  public async runArtifact(artifact: ProgramArtifact<ComputationProgramPayload>, input: unknown): Promise<unknown> {
    this.assertArtifact(artifact)
    return this.executor.run(artifact.payload, input, artifact.ref.identity)
  }

  public runSync(idOrIdentity: string | number, input: unknown): unknown {
    const directOverride = typeof idOrIdentity === 'string'
      ? Endge.bind.getComputation(idOrIdentity)
      : null
    if (directOverride)
      return this.runOverrideSync(idOrIdentity, directOverride, input)

    const artifact = this.requireArtifact(idOrIdentity)
    const identity = artifact.ref.identity
    const override = Endge.bind.getComputation(identity)
    if (override)
      return this.runOverrideSync(identity, override, input)
    return this.runArtifactSync(artifact, input)
  }

  public runArtifactSync(artifact: ProgramArtifact<ComputationProgramPayload>, input: unknown): unknown {
    this.assertArtifact(artifact)
    return this.executor.runSync(artifact.payload, input, artifact.ref.identity)
  }

  public createResource(identity: string, input: unknown, _consumerKey: string): ComputationResourceState {
    let isSync = true
    try {
      const override = Endge.bind.getComputation(identity)
      const artifact = override ? null : this.requireArtifact(identity)
      isSync = override ? override.execution === 'sync' : artifact!.payload.execution === 'sync'
    }
    catch (error) {
      return new ComputationResourceState(
        input,
        async () => { throw error },
        () => { throw error },
      )
    }
    return new ComputationResourceState(
      input,
      next => this.run(identity, next),
      isSync ? next => this.runSync(identity, next) : null,
    )
  }

  private requireArtifact(idOrIdentity: string | number): ProgramArtifact<ComputationProgramPayload> {
    const artifact = Endge.program.getComputationArtifact(idOrIdentity)
    if (!artifact)
      throw new ComputationRuntimeError(`Computation artifact "${String(idOrIdentity)}" is missing.`, String(idOrIdentity), 'artifact-missing')
    return artifact
  }

  private assertArtifact(artifact: ProgramArtifact<ComputationProgramPayload>): void {
    if (artifact.status === 'error')
      throw new ComputationRuntimeError(`Computation "${artifact.ref.identity}" contains compile errors.`, artifact.ref.identity, 'compile-errors')
  }

  private runOverrideSync(
    identity: string | number,
    override: NonNullable<ReturnType<typeof Endge.bind.getComputation>>,
    input: unknown,
  ): unknown {
    const key = String(identity)
    if (override.execution !== 'sync')
      throw new ComputationRuntimeError(`Computation override "${key}" is asynchronous.`, key, 'async-override')
    try {
      const result = override.run(input, this.api)
      if (result instanceof Promise)
        throw new ComputationRuntimeError(`Sync override "${key}" returned a Promise.`, key, 'invalid-sync-override')
      return result
    }
    catch (error) {
      if (error instanceof ComputationRuntimeError)
        throw error
      throw new ComputationRuntimeError(
        `Computation override "${key}" failed: ${error instanceof Error ? error.message : String(error)}`,
        key,
        'override-execution',
        undefined,
        { cause: error },
      )
    }
  }

  private async runOverride(
    identity: string | number,
    override: NonNullable<ReturnType<typeof Endge.bind.getComputation>>,
    input: unknown,
  ): Promise<unknown> {
    const key = String(identity)
    try {
      return await override.run(input, this.api)
    }
    catch (error) {
      if (error instanceof ComputationRuntimeError)
        throw error
      throw new ComputationRuntimeError(
        `Computation override "${key}" failed: ${error instanceof Error ? error.message : String(error)}`,
        key,
        'override-execution',
        undefined,
        { cause: error },
      )
    }
  }
}
