import type {
  ComputationExecutionApi,
  ComputationExecutionScope,
  ComputationSandboxAdapter,
  ComputationSandboxRequest,
  ComputationOverride,
} from '@/domain/types/computation/computation-runtime.types'
import type { EntityOrigin } from '@/domain/types/document/entity-management.type'
import type { ImplementationBindingScope } from '@/domain/types/runtime/action.types'
import type { ComputationProgramPayload } from '@/domain/types/computation/computation-program.types'
import type { ProgramArtifact } from '@/domain/types/program/program.types'

import { Endge } from '@/model/kernel/endge'
import {
  ENDGE_COMPUTATION_MAX_CALL_DEPTH,
  ENDGE_COMPUTATION_MAX_CALLS,
} from '@/model/config/kernel.config'
import { compileComputation } from '@/model/services/compiler/computation/computation-compile'
import { evaluateSourceExpression } from '@/model/services/source-engine/source-expression-evaluate'

import { ComputationGraphExecutor, ComputationRuntimeError } from './ComputationGraphExecutor'
import { ComputationResourceState } from './ComputationResource'
import { EndgeImplementations } from '@/model/modules/runtime/implementation/endge-implementations'

/** Executes compiled computation graphs and creates renderer-neutral resources. */
export class EndgeComputation {
  private readonly definitions = new Map<string, { identity: string, origin: EntityOrigin, defaultProviderKey?: string, execution?: 'sync' | 'async' }>()
  private readonly providers = new Map<string, ComputationOverride>()
  private readonly providerDisposers = new Set<VoidFunction>()
  private readonly definitionDisposers = new Set<VoidFunction>()
  private readonly bindingDisposers = new Set<VoidFunction>()
  private sandbox: ComputationSandboxAdapter | null = null
  private readonly executor = new ComputationGraphExecutor(
    () => this.sandbox,
    {
      run: (identity, input, scope) => this._run(identity, input, scope),
      runSync: (identity, input, scope) => this._runSync(identity, input, scope),
    },
  )
  private readonly api: ComputationExecutionApi = {
    evaluate: (expression, scope) => evaluateSourceExpression(expression, { scope }),
  }

  public constructor(private readonly implementations: EndgeImplementations) {}

  public hasDefinition(identity: string): boolean {
    return Endge.domain.getComputation(identity) != null
      || Endge.program.getComputationArtifact(identity) != null
      || this.definitions.has(identity)
  }

  /** Installs a serializable code-owned Computation definition. */
  public define(definition: { identity: string, origin: EntityOrigin, defaultProviderKey?: string, execution?: 'sync' | 'async' }): VoidFunction {
    const identity = String(definition.identity ?? '').trim()
    if (!identity) throw new Error('Computation identity is required.')
    if (Endge.domain.getComputation(identity) || this.definitions.has(identity)) throw new Error(`Computation identity collision: ${identity}.`)
    const stored = { ...definition, identity }
    this.definitions.set(identity, stored)
    const dispose = () => {
      if (this.definitions.get(identity) === stored) this.definitions.delete(identity)
      this.definitionDisposers.delete(dispose)
    }
    this.definitionDisposers.add(dispose)
    return dispose
  }

  /** Installs executable code separately from a Computation definition. */
  public provide(provider: { identity: string, key: string, origin?: EntityOrigin, implementation: ComputationOverride }): VoidFunction {
    const identity = String(provider.identity ?? '').trim()
    if (!Endge.domain.getComputation(identity) && !Endge.program.getComputationArtifact(identity) && !this.definitions.has(identity)) throw new Error(`Computation provider requires an existing definition: ${identity}.`)
    if (this.providers.has(provider.key)) throw new Error(`Computation provider key collision: ${provider.key}.`)
    this.providers.set(provider.key, provider.implementation)
    const disposeProvider = this.implementations.registerProvider({
      key: provider.key,
      origin: provider.origin ?? { kind: 'local', owner: 'application' },
      execute: invocation => provider.implementation.run(invocation.input, this.api),
    })
    const dispose = () => {
      disposeProvider()
      if (this.providers.get(provider.key) === provider.implementation) this.providers.delete(provider.key)
      this.providerDisposers.delete(dispose)
    }
    this.providerDisposers.add(dispose)
    return dispose
  }

  /** Selects one previously provided implementation without redefining semantics. */
  public override(binding: {
    identity: string
    providerKey: string
    scope?: Exclude<ImplementationBindingScope, 'default' | 'invocation'>
    scopeIdentity?: string
    priority?: number
  }): VoidFunction {
    if (!Endge.domain.getComputation(binding.identity) && !Endge.program.getComputationArtifact(binding.identity) && !this.definitions.has(binding.identity)) throw new Error(`Computation cannot be overridden because it does not exist: ${binding.identity}.`)
    if (!this.providers.has(binding.providerKey)) throw new Error(`Computation provider is not registered: ${binding.providerKey}.`)
    const artifact = Endge.program.getComputationArtifact(binding.identity)
    const definition = this.definitions.get(binding.identity)
    const provider = this.providers.get(binding.providerKey)!
    const execution = artifact?.payload.execution ?? definition?.execution
    if (execution === 'sync' && provider.execution !== 'sync')
      throw new Error(`Async Computation provider cannot override sync contract: ${binding.identity}.`)
    const disposeBinding = this.implementations.bind({
      executableType: 'computation',
      executableIdentity: binding.identity,
      providerKey: binding.providerKey,
      scope: binding.scope ?? 'application',
      scopeIdentity: binding.scopeIdentity,
      priority: binding.priority,
    })
    const dispose = () => {
      disposeBinding()
      this.bindingDisposers.delete(dispose)
    }
    this.bindingDisposers.add(dispose)
    return dispose
  }

  public setSandboxAdapter(adapter: ComputationSandboxAdapter | null): void {
    this.sandbox?.dispose?.()
    this.sandbox = adapter
  }

  /** Executes an already compiler-validated function in the shared isolated sandbox. */
  public async executeSandbox(request: ComputationSandboxRequest): Promise<unknown> {
    if (!this.sandbox)
      throw new ComputationRuntimeError('Computation sandbox adapter is not registered.', request.computationIdentity, 'sandbox-missing')
    return await this.sandbox.execute(request)
  }

  public async run(idOrIdentity: string | number, input: unknown): Promise<unknown> {
    return this._run(idOrIdentity, input, createExecutionScope())
  }

  public async runArtifact(artifact: ProgramArtifact<ComputationProgramPayload>, input: unknown): Promise<unknown> {
    this.assertArtifact(artifact)
    const scope = this._enterExecution(artifact.ref.identity, createExecutionScope())
    return this.executor.run(artifact.payload, input, artifact.ref.identity, scope)
  }

  /**
   * Компилирует и выполняет transient source без публикации в Endge.program.
   *
   * Используется редакторами и preview-инструментами для несохранённого draft.
   */
  public async runSource(
    source: string,
    input: unknown,
    identity = 'computation-source-preview',
  ): Promise<unknown> {
    const compiled = compileComputation({ source })
    const error = compiled.diagnostics.find(item => item.severity === 'error')
    if (error) {
      throw new ComputationRuntimeError(
        error.message,
        identity,
        'compile-errors',
      )
    }

    const scope = this._enterExecution(identity, createExecutionScope())
    return this.executor.run(compiled.payload, input, identity, scope)
  }

  public runSync(idOrIdentity: string | number, input: unknown): unknown {
    return this._runSync(idOrIdentity, input, createExecutionScope())
  }

  public runArtifactSync(artifact: ProgramArtifact<ComputationProgramPayload>, input: unknown): unknown {
    this.assertArtifact(artifact)
    const scope = this._enterExecution(artifact.ref.identity, createExecutionScope())
    return this.executor.runSync(artifact.payload, input, artifact.ref.identity, scope)
  }

  private async _run(
    idOrIdentity: string | number,
    input: unknown,
    parentScope: ComputationExecutionScope,
  ): Promise<unknown> {
    const directOverride = typeof idOrIdentity === 'string' ? this.resolveProvider(idOrIdentity) : null
    if (directOverride) {
      this._enterExecution(String(idOrIdentity), parentScope)
      return this.runOverride(idOrIdentity, directOverride, input)
    }

    const artifact = this.requireArtifact(idOrIdentity)
    const identity = artifact.ref.identity
    const scope = this._enterExecution(identity, parentScope)
    const override = this.resolveProvider(identity)
    if (override)
      return this.runOverride(identity, override, input)
    this.assertArtifact(artifact)
    return this.executor.run(artifact.payload, input, identity, scope)
  }

  private _runSync(
    idOrIdentity: string | number,
    input: unknown,
    parentScope: ComputationExecutionScope,
  ): unknown {
    const directOverride = typeof idOrIdentity === 'string' ? this.resolveProvider(idOrIdentity) : null
    if (directOverride) {
      this._enterExecution(String(idOrIdentity), parentScope)
      return this.runOverrideSync(idOrIdentity, directOverride, input)
    }

    const artifact = this.requireArtifact(idOrIdentity)
    const identity = artifact.ref.identity
    const scope = this._enterExecution(identity, parentScope)
    const override = this.resolveProvider(identity)
    if (override)
      return this.runOverrideSync(identity, override, input)
    this.assertArtifact(artifact)
    return this.executor.runSync(artifact.payload, input, identity, scope)
  }

  public createResource(identity: string, input: unknown, _consumerKey: string): ComputationResourceState {
    let isSync = true
    try {
      const override = this.resolveProvider(identity)
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

  /** Создает child scope и блокирует runtime recursion или чрезмерно глубокий call graph. */
  private _enterExecution(identity: string, parent: ComputationExecutionScope): ComputationExecutionScope {
    const cycleStart = parent.stack.indexOf(identity)
    if (cycleStart >= 0) {
      const cycle = [...parent.stack.slice(cycleStart), identity].join(' -> ')
      throw new ComputationRuntimeError(`Runtime computation cycle: ${cycle}.`, identity, 'dependency-cycle')
    }
    if (parent.stack.length >= ENDGE_COMPUTATION_MAX_CALL_DEPTH) {
      throw new ComputationRuntimeError(
        `Computation call depth exceeded ${ENDGE_COMPUTATION_MAX_CALL_DEPTH}.`,
        identity,
        'dependency-depth-limit',
      )
    }
    parent.budget.calls += 1
    if (parent.budget.calls > ENDGE_COMPUTATION_MAX_CALLS) {
      throw new ComputationRuntimeError(
        `Computation call budget exceeded ${ENDGE_COMPUTATION_MAX_CALLS}.`,
        identity,
        'dependency-call-limit',
      )
    }
    return { stack: [...parent.stack, identity], budget: parent.budget }
  }

  private runOverrideSync(
    identity: string | number,
    override: ComputationOverride,
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
    override: ComputationOverride,
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

  private resolveProvider(identity: string): ComputationOverride | null {
    const definition = this.definitions.get(identity)
    const resolved = this.implementations.resolveOptional({
      executable: { type: 'computation', identity },
      defaultProviderKey: definition?.defaultProviderKey ?? null,
    })
    return resolved ? this.providers.get(resolved.provider.key) ?? null : null
  }

  public reset(): void {
    for (const dispose of [...this.bindingDisposers]) dispose()
    for (const dispose of [...this.providerDisposers]) dispose()
    for (const dispose of [...this.definitionDisposers]) dispose()
  }
}

function createExecutionScope(): ComputationExecutionScope {
  return { stack: [], budget: { calls: 0 } }
}
