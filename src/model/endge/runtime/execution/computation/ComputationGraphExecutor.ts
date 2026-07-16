import type {
  ComputationProgramNode,
  ComputationProgramPayload,
  ComputationSandboxAdapter,
} from '@/domain/types/computation'
import type { SourceExpressionIR } from '@/domain/types/source/source-expression.types'

import { evaluateSourceExpression } from '@/model/services/source-engine/source-expression-evaluate'

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

/** Executes compiler-ordered computation graphs without evaluating authored JS in core. */
export class ComputationGraphExecutor {
  constructor(private readonly sandbox: () => ComputationSandboxAdapter | null) {}

  runSync(payload: ComputationProgramPayload, input: unknown, identity: string): unknown {
    if (payload.execution !== 'sync')
      throw new ComputationRuntimeError(`Computation "${identity}" requires asynchronous sandbox execution.`, identity, 'async-artifact')
    const outputs = new Map<string, unknown>()
    for (const node of payload.nodes) {
      if (node.kind !== 'expression')
        throw new ComputationRuntimeError(`Output "${node.name}" requires a sandbox.`, identity, 'async-output', node.name)
      outputs.set(node.name, this.evaluateNode(node.expression, input, outputs, identity, node.name))
    }
    return this.evaluateResult(payload, input, outputs, identity)
  }

  async run(payload: ComputationProgramPayload, input: unknown, identity: string): Promise<unknown> {
    if (payload.execution === 'sync')
      return this.runSync(payload, input, identity)

    const outputs = new Map<string, unknown>()
    const pending = new Map(payload.nodes.map(node => [node.name, node]))
    while (pending.size) {
      const ready = payload.nodes.filter(node => pending.has(node.name) && node.dependencies.every(dependency => outputs.has(dependency)))
      if (!ready.length)
        throw new ComputationRuntimeError(`Computation "${identity}" graph cannot make progress.`, identity, 'graph-deadlock')
      const values = await Promise.all(ready.map(async node => [node.name, await this.executeNode(node, input, outputs, identity)] as const))
      for (const [name, value] of values) {
        outputs.set(name, value)
        pending.delete(name)
      }
    }
    return this.evaluateResult(payload, input, outputs, identity)
  }

  private async executeNode(
    node: ComputationProgramNode,
    input: unknown,
    outputs: Map<string, unknown>,
    identity: string,
  ): Promise<unknown> {
    if (node.kind === 'expression')
      return this.evaluateNode(node.expression, input, outputs, identity, node.name)
    const sandbox = this.sandbox()
    if (!sandbox)
      throw new ComputationRuntimeError('Computation sandbox adapter is not installed.', identity, 'sandbox-missing', node.name)
    const inputs = Object.fromEntries(Object.entries(node.inputs).map(([name, expression]) => [name, this.evaluate(expression, input, outputs)]))
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
      if (error instanceof ComputationRuntimeError)
        throw error
      throw new ComputationRuntimeError(
        `TypeScript output "${node.name}" failed: ${error instanceof Error ? error.message : String(error)}`,
        identity,
        'sandbox-execution',
        node.name,
        { cause: error },
      )
    }
  }

  private evaluate(expression: SourceExpressionIR, input: unknown, outputs: Map<string, unknown>): unknown {
    return evaluateSourceExpression(expression, {
      scope: input,
      read: read => read.source === 'computation-output' ? outputs.get(read.path) : undefined,
    })
  }

  private evaluateResult(
    payload: ComputationProgramPayload,
    input: unknown,
    outputs: Map<string, unknown>,
    identity: string,
  ): unknown {
    if (!payload.result)
      throw new ComputationRuntimeError(`Computation "${identity}" has no compiled result.`, identity, 'result-missing')
    try {
      return this.evaluate(payload.result, input, outputs)
    }
    catch (error) {
      if (error instanceof ComputationRuntimeError)
        throw error
      throw new ComputationRuntimeError(
        `Computation "${identity}" result failed: ${error instanceof Error ? error.message : String(error)}`,
        identity,
        'result-execution',
        undefined,
        { cause: error },
      )
    }
  }

  private evaluateNode(
    expression: SourceExpressionIR,
    input: unknown,
    outputs: Map<string, unknown>,
    identity: string,
    outputName: string,
  ): unknown {
    try {
      return this.evaluate(expression, input, outputs)
    }
    catch (error) {
      if (error instanceof ComputationRuntimeError)
        throw error
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
