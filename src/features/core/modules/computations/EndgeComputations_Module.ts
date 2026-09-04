import type { ImplementationBindingScope } from '@/features/core/modules/actions/domain/action.types'
import type { ComputationProgramPayload } from '@/features/core/modules/domain/types/computation/computation-program.types'
import type {
  ComputationExecutionApi,
  ComputationExecutionScope,
  ComputationOverride,
  ComputationSandboxAdapter,
  ComputationSandboxRequest,
} from '@/features/core/modules/domain/types/computation/computation-runtime.types'
import type { EntityOrigin } from '@/features/core/modules/domain/types/document/entity-management.type'
import type { EndgeImplementations_Module } from '@/features/core/modules/implementations/EndgeImplementations_Module'

import type { ProgramArtifact } from '@/features/core/modules/program/domain/types/program.types'
import {
  ENDGE_COMPUTATION_MAX_CALL_DEPTH,
  ENDGE_COMPUTATION_MAX_CALLS,
} from '@/features/core/kernel/config/kernel.config'
import { Endge } from '@/features/core/kernel/endge'
import { compileComputation } from '@/features/core/modules/compiler/services/computation/computation-compile'

import { ComputationResourceState } from '@/features/core/modules/computations/model/ComputationResource'
import { ComputationGraphExecutor, ComputationRuntimeError } from '@/features/core/modules/computations/services/ComputationGraphExecutor'
import { evaluateSourceExpression } from '@/features/core/modules/source/services/source-expression-evaluate'
import { EndgeModule } from '@/features/federation/EndgeModule'

/** Выполняет скомпилированные графы computation и создаёт нейтральные к renderer ресурсы. */
export class EndgeComputations_Module extends EndgeModule {
  private readonly _definitions = new Map<string, { identity: string, origin: EntityOrigin, defaultProviderKey?: string, execution?: 'sync' | 'async' }>()
  private readonly _providers = new Map<string, ComputationOverride>()
  private readonly _providerDisposers = new Set<VoidFunction>()
  private readonly _definitionDisposers = new Set<VoidFunction>()
  private readonly _bindingDisposers = new Set<VoidFunction>()
  private _sandbox: ComputationSandboxAdapter | null = null
  private readonly _executor = new ComputationGraphExecutor(
    () => this._sandbox,
    {
      run: (identity, input, scope) => this._run(identity, input, scope),
      runSync: (identity, input, scope) => this._runSync(identity, input, scope),
    },
  )

  private readonly _api: ComputationExecutionApi = {
    evaluate: (expression, scope) => evaluateSourceExpression(expression, { scope }),
  }

  /**
   * ----------------------------------------
   * PUBLIC
   * ----------------------------------------
   */

  public constructor(private readonly _implementations: EndgeImplementations_Module) {
    super()
  }

  public hasDefinition(identity: string): boolean {
    return Endge.domain.getComputation(identity) != null
      || Endge.program.getComputationArtifact(identity) != null
      || this._definitions.has(identity)
  }

  /** Устанавливает сериализуемое определение Computation из кода. */
  public define(definition: { identity: string, origin: EntityOrigin, defaultProviderKey?: string, execution?: 'sync' | 'async' }): VoidFunction {
    const identity = String(definition.identity ?? '').trim()
    if (!identity) {
      throw new Error('Computation identity is required.')
    }
    if (Endge.domain.getComputation(identity) || this._definitions.has(identity)) {
      throw new Error(`Computation identity collision: ${identity}.`)
    }
    const stored = { ...definition, identity }
    this._definitions.set(identity, stored)
    const dispose = () => {
      if (this._definitions.get(identity) === stored) {
        this._definitions.delete(identity)
      }
      this._definitionDisposers.delete(dispose)
    }
    this._definitionDisposers.add(dispose)
    return dispose
  }

  /** Устанавливает исполняемый код отдельно от определения Computation. */
  public provide(provider: { identity: string, key: string, origin?: EntityOrigin, implementation: ComputationOverride }): VoidFunction {
    const identity = String(provider.identity ?? '').trim()
    if (!Endge.domain.getComputation(identity) && !Endge.program.getComputationArtifact(identity) && !this._definitions.has(identity)) {
      throw new Error(`Computation provider requires an existing definition: ${identity}.`)
    }
    if (this._providers.has(provider.key)) {
      throw new Error(`Computation provider key collision: ${provider.key}.`)
    }
    this._providers.set(provider.key, provider.implementation)
    const disposeProvider = this._implementations.registerProvider({
      key: provider.key,
      origin: provider.origin ?? { kind: 'local', owner: 'application' },
      execute: invocation => provider.implementation.run(invocation.input, this._api),
    })
    const dispose = () => {
      disposeProvider()
      if (this._providers.get(provider.key) === provider.implementation) {
        this._providers.delete(provider.key)
      }
      this._providerDisposers.delete(dispose)
    }
    this._providerDisposers.add(dispose)
    return dispose
  }

  /** Выбирает ранее предоставленную реализацию без переопределения семантики. */
  public override(binding: {
    identity: string
    providerKey: string
    scope?: Exclude<ImplementationBindingScope, 'default' | 'invocation'>
    scopeIdentity?: string
    priority?: number
  }): VoidFunction {
    if (!Endge.domain.getComputation(binding.identity) && !Endge.program.getComputationArtifact(binding.identity) && !this._definitions.has(binding.identity)) {
      throw new Error(`Computation cannot be overridden because it does not exist: ${binding.identity}.`)
    }
    if (!this._providers.has(binding.providerKey)) {
      throw new Error(`Computation provider is not registered: ${binding.providerKey}.`)
    }
    const artifact = Endge.program.getComputationArtifact(binding.identity)
    const definition = this._definitions.get(binding.identity)
    const provider = this._providers.get(binding.providerKey)!
    const execution = artifact?.payload.execution ?? definition?.execution
    if (execution === 'sync' && provider.execution !== 'sync') {
      throw new Error(`Async Computation provider cannot override sync contract: ${binding.identity}.`)
    }
    const disposeBinding = this._implementations.bind({
      executableType: 'computation',
      executableIdentity: binding.identity,
      providerKey: binding.providerKey,
      scope: binding.scope ?? 'application',
      scopeIdentity: binding.scopeIdentity,
      priority: binding.priority,
    })
    const dispose = () => {
      disposeBinding()
      this._bindingDisposers.delete(dispose)
    }
    this._bindingDisposers.add(dispose)
    return dispose
  }

  public setSandboxAdapter(adapter: ComputationSandboxAdapter | null): void {
    this._sandbox?.dispose?.()
    this._sandbox = adapter
  }

  /** Выполняет уже проверенную компилятором функцию в общем изолированном sandbox. */
  public async executeSandbox(request: ComputationSandboxRequest): Promise<unknown> {
    if (!this._sandbox) {
      throw new ComputationRuntimeError('Computation sandbox adapter is not registered.', request.computationIdentity, 'sandbox-missing')
    }
    return await this._sandbox.execute(request)
  }

  public async run(idOrIdentity: string | number, input: unknown): Promise<unknown> {
    return this._run(idOrIdentity, input, createExecutionScope())
  }

  public async runArtifact(artifact: ProgramArtifact<ComputationProgramPayload>, input: unknown): Promise<unknown> {
    this._assertArtifact(artifact)
    const scope = this._enterExecution(artifact.ref.identity, createExecutionScope())
    return this._executor.run(artifact.payload, input, artifact.ref.identity, scope)
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
    return this._executor.run(compiled.payload, input, identity, scope)
  }

  public runSync(idOrIdentity: string | number, input: unknown): unknown {
    return this._runSync(idOrIdentity, input, createExecutionScope())
  }

  public runArtifactSync(artifact: ProgramArtifact<ComputationProgramPayload>, input: unknown): unknown {
    this._assertArtifact(artifact)
    const scope = this._enterExecution(artifact.ref.identity, createExecutionScope())
    return this._executor.runSync(artifact.payload, input, artifact.ref.identity, scope)
  }

  public createResource(identity: string, input: unknown, _consumerKey: string): ComputationResourceState {
    let isSync = true
    try {
      const override = this._resolveProvider(identity)
      const artifact = override ? null : this._requireArtifact(identity)
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

  public override reset(): void {
    for (const dispose of [...this._bindingDisposers]) {
      dispose()
    }
    for (const dispose of [...this._providerDisposers]) {
      dispose()
    }
    for (const dispose of [...this._definitionDisposers]) {
      dispose()
    }
    this.setSandboxAdapter(null)
  }

  /**
   * ----------------------------------------
   * PRIVATE
   * ----------------------------------------
   */

  private async _run(
    idOrIdentity: string | number,
    input: unknown,
    parentScope: ComputationExecutionScope,
  ): Promise<unknown> {
    const directOverride = typeof idOrIdentity === 'string' ? this._resolveProvider(idOrIdentity) : null
    if (directOverride) {
      this._enterExecution(String(idOrIdentity), parentScope)
      return this._runOverride(idOrIdentity, directOverride, input)
    }

    const artifact = this._requireArtifact(idOrIdentity)
    const identity = artifact.ref.identity
    const scope = this._enterExecution(identity, parentScope)
    const override = this._resolveProvider(identity)
    if (override) {
      return this._runOverride(identity, override, input)
    }
    this._assertArtifact(artifact)
    return this._executor.run(artifact.payload, input, identity, scope)
  }

  private _runSync(
    idOrIdentity: string | number,
    input: unknown,
    parentScope: ComputationExecutionScope,
  ): unknown {
    const directOverride = typeof idOrIdentity === 'string' ? this._resolveProvider(idOrIdentity) : null
    if (directOverride) {
      this._enterExecution(String(idOrIdentity), parentScope)
      return this._runOverrideSync(idOrIdentity, directOverride, input)
    }

    const artifact = this._requireArtifact(idOrIdentity)
    const identity = artifact.ref.identity
    const scope = this._enterExecution(identity, parentScope)
    const override = this._resolveProvider(identity)
    if (override) {
      return this._runOverrideSync(identity, override, input)
    }
    this._assertArtifact(artifact)
    return this._executor.runSync(artifact.payload, input, identity, scope)
  }

  private _requireArtifact(idOrIdentity: string | number): ProgramArtifact<ComputationProgramPayload> {
    const artifact = Endge.program.getComputationArtifact(idOrIdentity)
    if (!artifact) {
      throw new ComputationRuntimeError(`Computation artifact "${String(idOrIdentity)}" is missing.`, String(idOrIdentity), 'artifact-missing')
    }
    return artifact
  }

  private _assertArtifact(artifact: ProgramArtifact<ComputationProgramPayload>): void {
    if (artifact.status === 'error') {
      throw new ComputationRuntimeError(`Computation "${artifact.ref.identity}" contains compile errors.`, artifact.ref.identity, 'compile-errors')
    }
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

  private _runOverrideSync(
    identity: string | number,
    override: ComputationOverride,
    input: unknown,
  ): unknown {
    const key = String(identity)
    if (override.execution !== 'sync') {
      throw new ComputationRuntimeError(`Computation override "${key}" is asynchronous.`, key, 'async-override')
    }
    try {
      const result = override.run(input, this._api)
      if (result instanceof Promise) {
        throw new ComputationRuntimeError(`Sync override "${key}" returned a Promise.`, key, 'invalid-sync-override')
      }
      return result
    }
    catch (error) {
      if (error instanceof ComputationRuntimeError) {
        throw error
      }
      throw new ComputationRuntimeError(
        `Computation override "${key}" failed: ${error instanceof Error ? error.message : String(error)}`,
        key,
        'override-execution',
        undefined,
        { cause: error },
      )
    }
  }

  private async _runOverride(
    identity: string | number,
    override: ComputationOverride,
    input: unknown,
  ): Promise<unknown> {
    const key = String(identity)
    try {
      return await override.run(input, this._api)
    }
    catch (error) {
      if (error instanceof ComputationRuntimeError) {
        throw error
      }
      throw new ComputationRuntimeError(
        `Computation override "${key}" failed: ${error instanceof Error ? error.message : String(error)}`,
        key,
        'override-execution',
        undefined,
        { cause: error },
      )
    }
  }

  private _resolveProvider(identity: string): ComputationOverride | null {
    const definition = this._definitions.get(identity)
    const resolved = this._implementations.resolveOptional({
      executable: { type: 'computation', identity },
      defaultProviderKey: definition?.defaultProviderKey ?? null,
    })
    return resolved ? this._providers.get(resolved.provider.key) ?? null : null
  }
}

function createExecutionScope(): ComputationExecutionScope {
  return { stack: [], budget: { calls: 0 } }
}
