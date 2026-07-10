/** Поддерживаемые scalar-типы полей source DSL. */
export type SourceFieldType = 'String' | 'Number' | 'Boolean' | 'Date' | 'DateTime' | 'Object'

/** Источник безопасного чтения значения внутри source expression. */
export type SourceExpressionReadKind = 'prop' | 'value' | 'row' | 'response' | 'store'

/** Whitelist операций статического expression IR. */
export type SourceExpressionOperation
  = | 'merge'
    | 'compact'
    | 'and'
    | 'between'
    | 'in-list'
    | 'in-array'
    | 'relative-date'
    | 'relative-date-time'

/**
 * Безопасное runtime-выражение, полученное из source callback.
 *
 * IR не содержит исполняемого JavaScript и вычисляется только штатным evaluator-ом.
 */
export type SourceExpressionIR
  = | { type: 'literal', value: unknown }
    | { type: 'object', properties: Record<string, SourceExpressionIR> }
    | { type: 'array', items: SourceExpressionIR[] }
    | { type: 'read', source: SourceExpressionReadKind, path: string }
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
  props?: Record<string, unknown>
  values?: Record<string, unknown>
  row?: unknown
  response?: unknown
  stores?: Record<string, unknown>
}
