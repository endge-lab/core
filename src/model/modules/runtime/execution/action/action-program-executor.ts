import type { RuntimeHost } from '@/domain/types/runtime/runtime-host.types'
import type { ActionProgramPayload } from '@/domain/types/program/action-program.types'
import type { ActionSourceBlock, ActionSourceOperationStep, ActionSourceStep } from '@/domain/types/source/action-source.types'
import type { SourceExpressionIR } from '@/domain/types/source/source-expression.types'
import { Endge } from '@/model/kernel/endge'
import { executeRuntimeOperation } from '@/model/modules/runtime/operation/operation-executor'
import { evaluateSourceExpression } from '@/model/services/source-engine/source-expression-evaluate'

interface ExecutionContext {
  input: unknown
  parent: RuntimeHost<any, any> | null
  outputs: Map<string, unknown>
  recordHistory: boolean
}

/** Executes compiler-produced Action IR without interpreting Source. */
export class ActionProgramExecutor {
  public async run(payload: ActionProgramPayload, input: unknown, parent: RuntimeHost<any, any> | null): Promise<unknown> {
    if (!payload.sourceDocument) throw new Error('Action artifact has no executable source document.')
    return await this.runBlock(payload.sourceDocument, { input, parent, outputs: new Map(), recordHistory: true })
  }

  private async runBlock(block: ActionSourceBlock, context: ExecutionContext): Promise<unknown> {
    for (const step of block.steps) context.outputs.set(step.name, await this.runStep(step, context))
    return block.output ? this.evaluate(block.output, context) : undefined
  }

  private async runStep(step: ActionSourceStep, context: ExecutionContext): Promise<unknown> {
    if (step.kind === 'expression') return this.evaluate(step.expression, context)
    if (step.kind === 'query') {
      const query = Endge.domain.getQuery(step.identity)
      if (!query) throw new Error(`Action Query is missing: ${step.identity}.`)
      const input = this.requireObject(this.evaluate(step.input, context), `Query ${step.identity}`)
      const host = await Endge.runtime.query.run(query, input, context.parent)
      return host
    }
    if (step.kind === 'update') {
      const input = this.evaluate(step.input, context)
      const composition = this.findComposition(context.parent)
      if (!composition) throw new Error(`Action Update requires a Composition runtime: ${step.identity}.`)
      composition.applyUpdateByIdentity(step.identity, input)
      return input
    }
    if (step.kind === 'action') {
      return await Endge.actions.execute(step.identity, {
        input: this.evaluate(step.input, context),
        context: { parentRuntimeId: context.parent?.id },
      })
    }
    if (step.kind === 'computation') return await Endge.runtime.computation.run(step.identity, this.evaluate(step.input, context))
    if (step.kind === 'typescript') {
      const inputs = Object.fromEntries(Object.entries(step.inputs).map(([name, expression]) => [name, this.evaluate(expression, context)]))
      return await Endge.runtime.computation.executeSandbox({
        computationIdentity: 'action',
        outputName: step.name,
        moduleKey: step.moduleKey,
        source: step.source,
        inputs,
      })
    }
    if (step.kind === 'operation') return await this.runOperation(step, context)
    throw new Error(`Unsupported Action step: ${(step as { kind: string }).kind}.`)
  }

  private async runOperation(step: ActionSourceOperationStep, outer: ExecutionContext): Promise<unknown> {
    const history = Endge.runtime.operations.resolveForHost(outer.parent)
    return await executeRuntimeOperation({
      id: `${step.name}:${Date.now()}`,
      input: step.input ? this.evaluate(step.input, outer) : outer.input,
      history,
      recordHistory: outer.recordHistory,
      run: async context => await this.runBlock(step.run, {
        input: context.input,
        parent: outer.parent,
        outputs: new Map(),
        recordHistory: false,
      }),
      undo: async context => await this.runBlock(step.undo, {
        input: withOperationOutputs(context.input, context.runOutput, undefined),
        parent: outer.parent,
        outputs: new Map(),
        recordHistory: false,
      }),
      redo: step.redo ? async context => await this.runBlock(step.redo!, {
        input: withOperationOutputs(context.input, context.runOutput, context.undoOutput),
        parent: outer.parent,
        outputs: new Map(),
        recordHistory: false,
      }) : null,
    })
  }

  private evaluate(expression: SourceExpressionIR, context: ExecutionContext): unknown {
    return evaluateSourceExpression(expression, {
      scope: context.input,
      read: read => read.source === 'computation-output' ? context.outputs.get(read.path) : undefined,
      transform: (transform, value, options) => transform.transform === 'data-view'
        ? Endge.runtime.dataView.run(transform.identity, value, undefined, { props: this.optionalObject(options) })
        : Endge.converters.execute(transform.identity, value, this.optionalObject(options)),
    })
  }

  private findComposition(host: RuntimeHost<any, any> | null): any | null {
    let current = host
    while (current) {
      if (current.entityType === 'composition') return current
      current = current.parent
    }
    return null
  }

  private requireObject(value: unknown, owner: string): Record<string, unknown> {
    if (value == null) return {}
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${owner} input must be an object.`)
    return value as Record<string, unknown>
  }

  private optionalObject(value: unknown): Record<string, unknown> | undefined {
    return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  }
}

function withOperationOutputs(snapshot: unknown, runOutput: unknown, undoOutput: unknown): unknown {
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) return { ...snapshot, __runOutput: runOutput, __undoOutput: undoOutput }
  return { value: snapshot, __runOutput: runOutput, __undoOutput: undoOutput }
}
