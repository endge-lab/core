import type { SourceExpressionIR } from '@/domain/types/source/source-expression.types'

export type ComputationResourceStatus = 'idle' | 'pending' | 'success' | 'error'

export interface ComputationRuntimeErrorShape {
  name: 'ComputationRuntimeError'
  message: string
  computationIdentity: string
  outputName?: string
  kind: string
}

export interface ComputationResource<T = unknown> {
  readonly status: ComputationResourceStatus
  readonly loading: boolean
  readonly value: T | undefined
  readonly error: ComputationRuntimeErrorShape | null
  refresh(): Promise<void>
  subscribe(listener: VoidFunction): VoidFunction
  dispose(): void
}

export interface ComputationSandboxRequest {
  computationIdentity: string
  outputName: string
  moduleKey: string
  source: string
  inputs: Record<string, unknown>
}

export interface ComputationSandboxAdapter {
  execute(request: ComputationSandboxRequest): Promise<unknown>
  dispose?(): void | Promise<void>
}

export interface ComputationExecutionApi {
  evaluate(expression: SourceExpressionIR, scope?: unknown): unknown
}

export interface ComputationOverride {
  execution: 'sync' | 'async'
  run(input: unknown, api: ComputationExecutionApi): unknown | Promise<unknown>
}
