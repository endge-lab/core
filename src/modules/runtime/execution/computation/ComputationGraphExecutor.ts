import type {
  ComputationProgramNode,
  ComputationProgramPayload,
} from '@/modules/domain/types/computation/computation-program.types'
import type {
  ComputationDependencyRunner,
  ComputationExecutionScope,
  ComputationSandboxAdapter,
} from '@/modules/domain/types/computation/computation-runtime.types'
import type { SourceExpressionIR } from '@/modules/source/domain/types/source-expression.types'

import { evaluateSourceExpression } from '@/modules/source/services/source-expression-evaluate'

export class ComputationRuntimeError extends Error {
  public readonly name = 'ComputationRuntimeError'

  constructor(
    message: string,
    public readonly computationIdentity: string,
    public readonly kind: string,
    public readonly outputName?: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      computationIdentity: this.computationIdentity,
      outputName: this.outputName,
      kind: this.kind,
    } as const
  }
}

/** Выполняет упорядоченные компилятором графы computation без вычисления пользовательского JS в core. */
export class ComputationGraphExecutor {
  constructor(
    private readonly _sandbox: () => ComputationSandboxAdapter | null,
    private readonly _dependencies: ComputationDependencyRunner | null = null,
  ) {}

  runSync(
    payload: ComputationProgramPayload,
    input: unknown,
    identity: string,
    scope?: ComputationExecutionScope,
  ): unknown {
    if (payload.execution !== 'sync') {
      throw new ComputationRuntimeError(`Computation "${identity}" requires asynchronous sandbox execution.`, identity, 'async-artifact')
    }
    const outputs = new Map<string, unknown>()
    for (const node of payload.nodes) {
      if (node.kind === 'typescript') {
        throw new ComputationRuntimeError(`Output "${node.name}" requires a sandbox.`, identity, 'async-output', node.name)
      }
      if (node.kind === 'computation') {
        if (!this._dependencies || !scope) {
          throw new ComputationRuntimeError(`Output "${node.name}" requires a computation dependency runner.`, identity, 'dependency-runner-missing', node.name)
        }
        const nestedInput = this._evaluateNode(node.input, input, outputs, identity, node.name)
        outputs.set(node.name, this._dependencies.runSync(node.identity, nestedInput, scope))
        continue
      }
      outputs.set(node.name, this._evaluateNode(node.expression, input, outputs, identity, node.name))
    }
    return this._evaluateResult(payload, input, outputs, identity)
  }

  async run(
    payload: ComputationProgramPayload,
    input: unknown,
    identity: string,
    scope?: ComputationExecutionScope,
  ): Promise<unknown> {
    if (payload.execution === 'sync') {
      return this.runSync(payload, input, identity, scope)
    }

    const outputs = new Map<string, unknown>()
    const pending = new Map(payload.nodes.map(node => [node.name, node]))
    while (pending.size) {
      const ready = payload.nodes.filter(node => pending.has(node.name) && node.dependencies.every(dependency => outputs.has(dependency)))
      if (!ready.length) {
        throw new ComputationRuntimeError(`Computation "${identity}" graph cannot make progress.`, identity, 'graph-deadlock')
      }
      const values = await Promise.all(ready.map(async node => [
        node.name,
        await this._executeNode(node, input, outputs, identity, scope),
      ] as const))
      for (const [name, value] of values) {
        outputs.set(name, value)
        pending.delete(name)
      }
    }
    return this._evaluateResult(payload, input, outputs, identity)
  }

  private async _executeNode(
    node: ComputationProgramNode,
    input: unknown,
    outputs: Map<string, unknown>,
    identity: string,
    scope?: ComputationExecutionScope,
  ): Promise<unknown> {
    if (node.kind === 'expression') {
      return this._evaluateNode(node.expression, input, outputs, identity, node.name)
    }
    if (node.kind === 'computation') {
      if (!this._dependencies || !scope) {
        throw new ComputationRuntimeError(`Output "${node.name}" requires a computation dependency runner.`, identity, 'dependency-runner-missing', node.name)
      }
      const nestedInput = this._evaluateNode(node.input, input, outputs, identity, node.name)
      return this._dependencies.run(node.identity, nestedInput, scope)
    }
    const sandbox = this._sandbox()
    if (!sandbox) {
      throw new ComputationRuntimeError('Computation sandbox adapter is not installed.', identity, 'sandbox-missing', node.name)
    }
    const inputs = Object.fromEntries(Object.entries(node.inputs).map(([name, expression]) => [name, this._evaluate(expression, input, outputs)]))
    try {
      return await sandbox.execute({
        computationIdentity: identity,
        outputName: node.name,
        moduleKey: node.moduleKey,
        source: node.source,
        inputs,
      })
    }
    catch (error) {
      if (error instanceof ComputationRuntimeError) {
        throw error
      }
      throw new ComputationRuntimeError(
        `TypeScript output "${node.name}" failed: ${error instanceof Error ? error.message : String(error)}`,
        identity,
        'sandbox-execution',
        node.name,
        { cause: error },
      )
    }
  }

  private _evaluate(expression: SourceExpressionIR, input: unknown, outputs: Map<string, unknown>): unknown {
    return evaluateSourceExpression(expression, {
      scope: input,
      read: read => read.source === 'computation-output' ? outputs.get(read.path) : undefined,
    })
  }

  private _evaluateResult(
    payload: ComputationProgramPayload,
    input: unknown,
    outputs: Map<string, unknown>,
    identity: string,
  ): unknown {
    if (!payload.result) {
      throw new ComputationRuntimeError(`Computation "${identity}" has no compiled result.`, identity, 'result-missing')
    }
    try {
      return this._evaluate(payload.result, input, outputs)
    }
    catch (error) {
      if (error instanceof ComputationRuntimeError) {
        throw error
      }
      throw new ComputationRuntimeError(
        `Computation "${identity}" result failed: ${error instanceof Error ? error.message : String(error)}`,
        identity,
        'result-execution',
        undefined,
        { cause: error },
      )
    }
  }

  private _evaluateNode(
    expression: SourceExpressionIR,
    input: unknown,
    outputs: Map<string, unknown>,
    identity: string,
    outputName: string,
  ): unknown {
    try {
      return this._evaluate(expression, input, outputs)
    }
    catch (error) {
      if (error instanceof ComputationRuntimeError) {
        throw error
      }
      throw new ComputationRuntimeError(
        `Expression output "${outputName}" failed: ${error instanceof Error ? error.message : String(error)}`,
        identity,
        'expression-execution',
        outputName,
        { cause: error },
      )
    }
  }
}
