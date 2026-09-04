import type { ComputationSourceDocument } from './computation-source.types'
import type { SourceExpressionIR } from '@/features/core/modules/source/domain/types/source-expression.types'

/** Необязательные сохраняемые метаданные; компилятор v1 не сравнивает контракты. */
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
  | {
    kind: 'computation'
    name: string
    dependencies: string[]
    identity: string
    input: SourceExpressionIR
  }

/** Готовый для runtime граф, скомпилированный из одного Source-документа defineComputation. */
export interface ComputationProgramPayload {
  input: ComputationContractField | null
  output: ComputationContractField | null
  sourceDocument: ComputationSourceDocument | null
  nodes: ComputationProgramNode[]
  result: SourceExpressionIR | null
  execution: 'sync' | 'async'
}
