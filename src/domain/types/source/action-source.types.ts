import type { SourceExpressionIR, SourceFieldDefinition } from '@/domain/types/source/source-expression.types'

export interface ActionSourceContract {
  input: SourceFieldDefinition | null
  output: SourceFieldDefinition | null
}

export type ActionSourceEffectKind = 'query' | 'update' | 'action' | 'computation'

export interface ActionSourceEffectStep {
  kind: ActionSourceEffectKind
  name: string
  identity: string
  input: SourceExpressionIR
}

export interface ActionSourceExpressionStep {
  kind: 'expression'
  name: string
  expression: SourceExpressionIR
}

export interface ActionSourceTypescriptStep {
  kind: 'typescript'
  name: string
  inputs: Record<string, SourceExpressionIR>
  moduleKey: string
  source: string
}

export interface ActionSourceOperationStep {
  kind: 'operation'
  name: string
  input: SourceExpressionIR
  run: ActionSourceBlock
  undo: ActionSourceBlock
  redo: ActionSourceBlock | null
}

export type ActionSourceStep
  = | ActionSourceExpressionStep
    | ActionSourceEffectStep
    | ActionSourceTypescriptStep
    | ActionSourceOperationStep

export interface ActionSourceBlock {
  steps: ActionSourceStep[]
  output: SourceExpressionIR | null
}

export interface ActionSourceDocument extends ActionSourceBlock {
  contract: ActionSourceContract
}

