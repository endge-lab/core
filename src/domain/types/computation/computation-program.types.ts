import type { SourceExpressionIR } from '@/domain/types/source/source-expression.types'
import type { ComputationSourceDocument } from './computation-source.types'

/** Optional persisted metadata; v1 compiler does not compare contracts. */
export interface ComputationContractField {
  type: string
  isArray?: boolean
  optional?: boolean
}

export type ComputationProgramNode
  = | {
    kind: 'expression'
    name: string
    dependencies: string[]
    expression: SourceExpressionIR
  }
  | {
    kind: 'typescript'
    name: string
    dependencies: string[]
    inputs: Record<string, SourceExpressionIR>
    moduleKey: string
    source: string
  }

/** Runtime-ready graph compiled from one defineComputation source document. */
export interface ComputationProgramPayload {
  input: ComputationContractField | null
  output: ComputationContractField | null
  sourceDocument: ComputationSourceDocument | null
  nodes: ComputationProgramNode[]
  result: SourceExpressionIR | null
  execution: 'sync' | 'async'
}
