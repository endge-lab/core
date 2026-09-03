import type { RQuery } from '@/modules/domain/entities/RQuery'
import type { ComputationSandboxRequest } from '@/modules/domain/types/computation/computation-runtime.types'
import type { ActionProgramPayload } from '@/modules/program/domain/types/action-program.types'
import type { RuntimeHost } from '@/modules/runtime/domain/runtime-host.types'
import type { OperationHistory } from '@/modules/runtime/operation/operation-history'
import type { ActionSourceBlock, ActionSourceOperationStep, ActionSourceStep } from '@/modules/source/domain/types/action-source.types'
import type { SourceExpressionIR } from '@/modules/source/domain/types/source-expression.types'
import { executeRuntimeOperation } from '@/modules/runtime/operation/operation-executor'
import { evaluateSourceExpression } from '@/modules/source/services/source-expression-evaluate'

export interface ActionProgramExecutorDependencies {
  resolveQuery: (identity: string) => RQuery | null
  runQuery: (query: RQuery, input: Record<string, unknown>, parent: RuntimeHost<any, any> | null) => Promise<unknown>
  executeAction: (identity: string, input: unknown, parentRuntimeId?: string) => Promise<unknown>
  runComputation: (identity: string, input: unknown) => Promise<unknown>
  executeSandbox: (request: ComputationSandboxRequest) => Promise<unknown>
  resolveOperationHistory: (parent: RuntimeHost<any, any> | null) => OperationHistory | null
  runDataView: (identity: string, input: unknown, props?: Record<string, unknown>) => unknown
  executeConverter: (identity: string, input: unknown, options?: Record<string, unknown>) => unknown
}

interface ExecutionContext {
  input: unknown
  parent: RuntimeHost<any, any> | null
  outputs: Map<string, unknown>
  recordHistory: boolean
}

/** Executes compiler-produced Action IR without interpreting Source. */
export class ActionProgramExecutor {
  public constructor(private readonly _dependencies: ActionProgramExecutorDependencies) {}

  public async run(payload: ActionProgramPayload, input: unknown, parent: RuntimeHost<any, any> | null): Promise<unknown> {
    if (!payload.sourceDocument) {
      throw new Error('Action artifact has no executable source document.')
    }
    return await this._runBlock(payload.sourceDocument, { input, parent, outputs: new Map(), recordHistory: true })
  }

  private async _runBlock(block: ActionSourceBlock, context: ExecutionContext): Promise<unknown> {
    for (const step of block.steps) {
      context.outputs.set(step.name, await this._runStep(step, context))
    }
    return block.output ? this._evaluate(block.output, context) : undefined
  }

  private async _runStep(step: ActionSourceStep, context: ExecutionContext): Promise<unknown> {
    if (step.kind === 'expression') {
      return this._evaluate(step.expression, context)
    }
    if (step.kind === 'query') {
      const query = this._dependencies.resolveQuery(step.identity)
      if (!query) {
        throw new Error(`Action Query is missing: ${step.identity}.`)
      }
      const input = this._requireObject(this._evaluate(step.input, context), `Query ${step.identity}`)
      const host = await this._dependencies.runQuery(query, input, context.parent)
      return host
    }
    if (step.kind === 'update') {
      const input = this._evaluate(step.input, context)
      const composition = this._findComposition(context.parent)
      if (!composition) {
        throw new Error(`Action Update requires a Composition runtime: ${step.identity}.`)
      }
      composition.applyUpdateByIdentity(step.identity, input)
      return input
    }
    if (step.kind === 'action') {
      return await this._dependencies.executeAction(step.identity, this._evaluate(step.input, context), context.parent?.id)
    }
    if (step.kind === 'computation') {
      return await this._dependencies.runComputation(step.identity, this._evaluate(step.input, context))
    }
    if (step.kind === 'typescript') {
      const inputs = Object.fromEntries(Object.entries(step.inputs).map(([name, expression]) => [name, this._evaluate(expression, context)]))
      return await this._dependencies.executeSandbox({
        computationIdentity: 'action',
        outputName: step.name,
        moduleKey: step.moduleKey,
        source: step.source,
        inputs,
      })
    }
    if (step.kind === 'operation') {
      return await this._runOperation(step, context)
    }
    throw new Error(`Unsupported Action step: ${(step as { kind: string }).kind}.`)
  }

  private async _runOperation(step: ActionSourceOperationStep, outer: ExecutionContext): Promise<unknown> {
    const history = this._dependencies.resolveOperationHistory(outer.parent)
    return await executeRuntimeOperation({
      id: `${step.name}:${Date.now()}`,
      input: step.input ? this._evaluate(step.input, outer) : outer.input,
      history,
      recordHistory: outer.recordHistory,
      run: async context => await this._runBlock(step.run, {
        input: context.input,
        parent: outer.parent,
        outputs: new Map(),
        recordHistory: false,
      }),
      undo: async context => await this._runBlock(step.undo, {
        input: withOperationOutputs(context.input, context.runOutput, undefined),
        parent: outer.parent,
        outputs: new Map(),
        recordHistory: false,
      }),
      redo: step.redo
        ? async context => await this._runBlock(step.redo!, {
          input: withOperationOutputs(context.input, context.runOutput, context.undoOutput),
          parent: outer.parent,
          outputs: new Map(),
          recordHistory: false,
        })
        : null,
    })
  }

  private _evaluate(expression: SourceExpressionIR, context: ExecutionContext): unknown {
    return evaluateSourceExpression(expression, {
      scope: context.input,
      read: read => read.source === 'computation-output' ? context.outputs.get(read.path) : undefined,
      transform: (transform, value, options) => transform.transform === 'data-view'
        ? this._dependencies.runDataView(transform.identity, value, this._optionalObject(options))
        : this._dependencies.executeConverter(transform.identity, value, this._optionalObject(options)),
    })
  }

  private _findComposition(host: RuntimeHost<any, any> | null): any | null {
    let current = host
    while (current) {
      if (current.entityType === 'composition') {
        return current
      }
      current = current.parent
    }
    return null
  }

  private _requireObject(value: unknown, owner: string): Record<string, unknown> {
    if (value == null) {
      return {}
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`${owner} input must be an object.`)
    }
    return value as Record<string, unknown>
  }

  private _optionalObject(value: unknown): Record<string, unknown> | undefined {
    return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  }
}

function withOperationOutputs(snapshot: unknown, runOutput: unknown, undoOutput: unknown): unknown {
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
    return { ...snapshot, __runOutput: runOutput, __undoOutput: undoOutput }
  }
  return { value: snapshot, __runOutput: runOutput, __undoOutput: undoOutput }
}
