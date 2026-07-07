import type { ProgramDiagnostic } from '@/domain/types/program.types'

export type DataViewSourceMode = 'manual' | 'pipeline'

export interface DataViewSourceDocument {
  mode: DataViewSourceMode
  transform?: DataViewManualTransform
  steps?: DataViewPipelineStep[]
}

export interface DataViewManualTransform {
  params: string[]
  body: string
}

export type DataViewPipelineStep
  = | DataViewFromStep
    | DataViewJoinStep
    | DataViewMapStep

export interface DataViewFromStep {
  type: 'from'
  source: string
  as: string
}

export interface DataViewJoinStep {
  type: 'join'
  source: string
  left: string
  right: string
  as: string
}

export interface DataViewMapStep {
  type: 'map'
  spreads: DataViewMapSpread[]
  fields: Record<string, DataViewExpression>
}

export interface DataViewMapSpread {
  source: string
}

export type DataViewExpression
  = | DataViewPathExpression
    | DataViewTemplateExpression
    | DataViewLiteralExpression

export interface DataViewPathExpression {
  type: 'path'
  path: string
  operations: DataViewPathOperation[]
}

export type DataViewPathOperation
  = | { type: 'find', criteria: Record<string, unknown> }
    | { type: 'pick', path: string }
    | { type: 'convert', converter: string, options?: Record<string, unknown> }

export interface DataViewTemplateExpression {
  type: 'template'
  template: string
}

export interface DataViewLiteralExpression {
  type: 'literal'
  value: unknown
}

export interface DataViewSourceCompileResult {
  ast: unknown
  document: DataViewSourceDocument | null
  artifact: unknown | null
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
}

export interface DataViewRunTools {
  convert: (identity: string, value: unknown, options?: Record<string, unknown>) => unknown
  pick: (value: unknown, path: string) => unknown
  path: (scope: unknown, path: string) => unknown
  template: (template: string, scope?: Record<string, unknown>) => string
}
