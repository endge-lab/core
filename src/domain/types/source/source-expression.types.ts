/** Type Registry identity used by Query/Filter field contracts. */
export type SourceFieldType
  = | 'String'
    | 'Number'
    | 'Boolean'
    | 'Date'
    | 'Time'
    | 'DateTime'
    | 'Object'
    | 'Any'
    | (string & {})

/** Источник безопасного чтения значения внутри source expression. */
export type SourceExpressionReadKind
  = | 'env'
    | 'prop'
    | 'value'
    | 'row'
    | 'response'
    | 'store'
    | 'current'
    | 'scope'
    | 'composition-output'
    | 'composition-data'
    | 'composition-store'
    | 'composition-filter-fields'
    | 'metadata'
    | 'computation-output'

/** Whitelist операций статического expression IR. */
export type SourceExpressionOperation
  = | 'merge'
    | 'compact'
    | 'get'
    | 'get-or'
    | 'has'
    | 'default-to'
    | 'pick'
    | 'omit'
    | 'defaults'
    | 'keys'
    | 'values'
    | 'entries'
    | 'map'
    | 'where'
    | 'reject'
    | 'find'
    | 'some'
    | 'every'
    | 'flat-map'
    | 'flatten'
    | 'uniq'
    | 'uniq-by'
    | 'concat'
    | 'take'
    | 'drop'
    | 'sort-by'
    | 'group-by'
    | 'key-by'
    | 'size'
    | 'sum'
    | 'sum-by'
    | 'min'
    | 'max'
    | 'min-by'
    | 'max-by'
    | 'trim'
    | 'lower-case'
    | 'upper-case'
    | 'split'
    | 'join'
    | 'match'
    | 'eq'
    | 'ne'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'includes'
    | 'or'
    | 'when'
    | 'not'
    | 'is-nil'
    | 'is-empty'
    | 'and'
    | 'between'
    | 'in-list'
    | 'in-array'
    | 'relative-date'
    | 'relative-date-time'
    | 'left-join'
    | 'full-join'
    | 'join-by'
    | 'join-by-any'
    | 'join-coalesce'
    | 'lookup-one'
    | 'lookup-many'
    | 'enrich'

/**
 * Безопасное runtime-выражение, полученное из source callback.
 *
 * IR не содержит исполняемого JavaScript и вычисляется только штатным evaluator-ом.
 */
export type SourceExpressionIR
  = | { type: 'literal', value: unknown }
    | { type: 'object', properties: Record<string, SourceExpressionIR> }
    | { type: 'array', items: SourceExpressionIR[] }
    | { type: 'read', source: SourceExpressionReadKind, path: string, parameters?: string[] }
    | {
      type: 'operation'
      operation: SourceExpressionOperation
      arguments: SourceExpressionIR[]
    }

/** Статический вариант выбора source-field. */
export interface SourceFieldOption {
  value: string | number | boolean
  label?: string
}

/** Ссылка source-field на доменный vocab. */
export interface SourceFieldVocab {
  identity: string
  valuePath: string
  labelPath: string
}

/** Общий compiled field contract для Filter и Query props. */
export interface SourceFieldDefinition {
  key: string
  type: SourceFieldType
  optional: boolean
  array: boolean
  defaultValue?: SourceExpressionIR
  options?: SourceFieldOption[]
  vocab?: SourceFieldVocab
}

/** Default value prop, вычисляемый через output внешнего или локального Filter. */
export type SourceFieldDefaultSource
  = | { kind: 'filter', identity: string, output: string }
    | { kind: 'inline-filter', source: string, output: string }
    | {
      kind: 'local-filter'
      ref: { entityType: 'filter', id: string | number, identity: string }
      output: string
    }

/** Query prop на базе общего field contract. */
export interface QueryProgramProp extends SourceFieldDefinition {
  defaultSource?: SourceFieldDefaultSource
}

/** Контекст вычисления безопасного source expression. */
export interface SourceExpressionContext {
  /** Resolves an env(name) read without exposing the workspace to the evaluator. */
  environment?: (name: string) => unknown
  props?: Record<string, unknown>
  values?: Record<string, unknown>
  row?: unknown
  response?: unknown
  stores?: Record<string, unknown>
  current?: unknown
  scope?: unknown
  read?: (expression: Extract<SourceExpressionIR, { type: 'read' }>) => unknown
  onWarning?: (warning: SourceExpressionWarning) => void
}

/** Публичное имя общего декларативного value DSL. */
export type ValueExpressionIR = SourceExpressionIR
export type ValueExpressionContext = SourceExpressionContext

/** Runtime warning безопасного expression evaluator. */
export interface SourceExpressionWarning {
  code: string
  message: string
  data?: unknown
}
