import type { ComputationContractField } from './computation-program.types'
import type { SourceExpressionIR } from '@/features/core/modules/source/domain/types/source-expression.types'

export interface ComputationSourceRange {
  start: number
  end: number
}

export type ComputationSourceNode
  = | {
    kind: 'expression'
    name: string
    expression: SourceExpressionIR
    sourceRange?: ComputationSourceRange
  }
  | {
    kind: 'typescript'
    name: string
    inputs: Record<string, SourceExpressionIR>
    source: string
    sourceRange?: ComputationSourceRange
  }
  | {
    kind: 'computation'
    name: string
    identity: string
    input: SourceExpressionIR
    sourceRange?: ComputationSourceRange
  }

/** Каноническое представление source defineComputation, полученное компилятором. */
export interface ComputationSourceDocument {
  input: ComputationContractField | null
  output: ComputationContractField | null
  outputs: ComputationSourceNode[]
  result: SourceExpressionIR
}
