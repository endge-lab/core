import type { SourceExpressionIR } from '@/domain/types/source/source-expression.types'

export type ComputationImplementationKind = 'source' | 'provider'

export type ComputationSourceLanguage = 'typescript' | 'endge'

/** Compiler-derived contract одного входа или результата computation. */
export interface ComputationContractField {
  type: string
  isArray?: boolean
  optional?: boolean
}

/** Runtime-ready payload source computation без исполняемого JavaScript. */
export interface ComputationProgramPayload {
  implementationKind: ComputationImplementationKind
  sourceLanguage: ComputationSourceLanguage
  input: ComputationContractField | null
  output: ComputationContractField | null
  expression: SourceExpressionIR | null
}
