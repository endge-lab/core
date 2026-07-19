import type { EntityOrigin } from '@/domain/types/document/entity-management.type'
import type {
  ActionExecutionTarget,
  ActionTargetSelector,
  ImplementationBindingScope,
} from '@/domain/types/runtime/action.types'

export interface ImplementationContract {
  target?: ActionTargetSelector[] | null
  input?: unknown | null
  output?: unknown | null
}

export interface ImplementationExecutableRef {
  type: string
  identity: string
  value?: unknown
}

export interface ImplementationInvocation<TInput = unknown> {
  executable: ImplementationExecutableRef
  input?: TInput
  target?: ActionExecutionTarget
  context?: Record<string, unknown>
}

export interface ImplementationProvider<TInput = unknown, TResult = unknown> {
  key: string
  origin: EntityOrigin
  active?: boolean
  contract?: ImplementationContract
  canExecute?: (invocation: ImplementationInvocation<TInput>) => boolean
  execute: (invocation: ImplementationInvocation<TInput>) => TResult | Promise<TResult>
}

export interface ImplementationBinding {
  executableType: string
  executableIdentity: string
  providerKey: string
  scope: Exclude<ImplementationBindingScope, 'default'>
  scopeIdentity?: string
  priority?: number
}

export interface ImplementationResolutionRequest {
  executable: ImplementationExecutableRef
  defaultProviderKey: string | null
  scopeIdentities?: Partial<Record<Exclude<ImplementationBindingScope, 'default'>, string>>
  invocationProviderKey?: string
  expectedContract?: ImplementationContract
}

export interface ResolvedImplementation {
  provider: ImplementationProvider
  binding: ImplementationBinding | null
  scope: ImplementationBindingScope
}

export interface ImplementationSnapshot {
  providers: Array<{
    key: string
    active: boolean
    origin: EntityOrigin
  }>
  bindings: ImplementationBinding[]
}

export type ImplementationDiagnosticCode
  = 'implementation-provider-missing'
    | 'implementation-provider-inactive'
    | 'implementation-binding-ambiguous'
    | 'implementation-cannot-execute'
    | 'implementation-contract-incompatible'

export class ImplementationError extends Error {
  public constructor(
    public readonly code: ImplementationDiagnosticCode,
    message: string,
  ) {
    super(message)
    this.name = 'ImplementationError'
  }
}
