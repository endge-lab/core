import type { ProgramDiagnostic } from '@/domain/types/program/program.types'
import type { ProgramMetadataMap } from '@/domain/types/program/program-metadata.types'
import type { SourceExpressionIR } from '@/domain/types/source/source-expression.types'

export type DataViewSourceMode = 'manual' | 'pipeline' | 'projection' | 'expression'

export type DataViewIncrementalRequest
  = | { mode: 'auto' }
    | { mode: 'full' }
    | { mode: 'collection-by-key', key: string }

export type DataViewMaterializationStrategy
  = | { kind: 'full' }
    | { kind: 'collection-by-key', key: string }

export interface DataViewSourceDocument {
  mode: DataViewSourceMode
  incremental: DataViewIncrementalRequest
  transform?: DataViewManualTransform
  steps?: DataViewPipelineStep[]
  output?: Record<string, SourceExpressionIR>
  expression?: SourceExpressionIR
}

export interface DataViewManualTransform {
  params: string[]
  body: string
}

export type DataViewPipelineStep
  = | DataViewFromStep
    | DataViewJoinStep
    | DataViewMapStep
    | DataViewSelectStep

export interface DataViewSelectStep {
  type: 'select'
  expression: SourceExpressionIR
}

export interface DataViewFromStep {
  type: 'from'
  source: string
  as: string
  dataViews?: DataViewRef[]
}

export type DataViewRef
  = | DataViewExternalRef
    | DataViewInlineRef
    | DataViewLocalRef

export interface DataViewExternalRef {
  kind: 'external'
  identity: string
}

export interface DataViewInlineRef {
  kind: 'inline'
  source: string
}

export interface DataViewLocalRef {
  kind: 'local'
  ref: {
    entityType: 'data-view'
    id: string | number
    identity: string
  }
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
    | SourceExpressionIR

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
  metadata: ProgramMetadataMap
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
}

export interface DataViewRunTools {
  convert: (identity: string, value: unknown, options?: Record<string, unknown>) => unknown
  pick: (value: unknown, path: string) => unknown
  path: (scope: unknown, path: string) => unknown
  template: (template: string, scope?: Record<string, unknown>) => string
}
