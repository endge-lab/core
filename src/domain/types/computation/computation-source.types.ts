import type { SourceExpressionIR } from '@/domain/types/source/source-expression.types'

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

/** Canonical compiler-derived representation of defineComputation source. */
export interface ComputationSourceDocument {
  outputs: ComputationSourceNode[]
  result: SourceExpressionIR
}
