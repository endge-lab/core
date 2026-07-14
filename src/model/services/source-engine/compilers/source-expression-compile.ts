import type { ProgramDiagnostic } from '@/domain/types/program/program.types'
import type {
  SourceExpressionIR,
  SourceExpressionOperation,
  SourceExpressionReadKind,
} from '@/domain/types/source/source-expression.types'

import * as t from '@babel/types'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

const READ_FUNCTIONS: Record<string, SourceExpressionReadKind> = {
  prop: 'prop',
  value: 'value',
  row: 'row',
  response: 'response',
  store: 'store',
  path: 'scope',
}

const OPERATION_FUNCTIONS: Record<string, SourceExpressionOperation> = {
  merge: 'merge',
  compact: 'compact',
  get: 'get',
  getOr: 'get-or',
  has: 'has',
  defaultTo: 'default-to',
  pick: 'pick',
  omit: 'omit',
  defaults: 'defaults',
  keys: 'keys',
  values: 'values',
  entries: 'entries',
  map: 'map',
  where: 'where',
  reject: 'reject',
  find: 'find',
  some: 'some',
  every: 'every',
  flatMap: 'flat-map',
  flatten: 'flatten',
  uniq: 'uniq',
  uniqBy: 'uniq-by',
  concat: 'concat',
  take: 'take',
  drop: 'drop',
  sortBy: 'sort-by',
  groupBy: 'group-by',
  keyBy: 'key-by',
  size: 'size',
  sum: 'sum',
  sumBy: 'sum-by',
  min: 'min',
  max: 'max',
  minBy: 'min-by',
  maxBy: 'max-by',
  trim: 'trim',
  lowerCase: 'lower-case',
  upperCase: 'upper-case',
  split: 'split',
  join: 'join',
  match: 'match',
  eq: 'eq',
  ne: 'ne',
  gt: 'gt',
  gte: 'gte',
  lt: 'lt',
  lte: 'lte',
  includes: 'includes',
  or: 'or',
  not: 'not',
  isNil: 'is-nil',
  isEmpty: 'is-empty',
  and: 'and',
  between: 'between',
  inList: 'in-list',
  inArray: 'in-array',
  relativeDate: 'relative-date',
  relativeDateTime: 'relative-date-time',
  leftJoin: 'left-join',
  fullJoin: 'full-join',
  by: 'join-by',
  byAny: 'join-by-any',
  coalesce: 'join-coalesce',
  lookupOne: 'lookup-one',
  lookupMany: 'lookup-many',
  enrich: 'enrich',
}

const IMPLICIT_CURRENT_OPERATIONS = new Set<SourceExpressionOperation>([
  'get', 'get-or', 'has', 'pick', 'omit', 'match', 'is-nil', 'is-empty',
])

const CHAIN_OPERATIONS = new Set(Object.values(OPERATION_FUNCTIONS))

const OPERATION_ARITY: Record<SourceExpressionOperation, { min: number, max?: number }> = {
  merge: { min: 2 },
  compact: { min: 1, max: 1 },
  get: { min: 2, max: 2 },
  'get-or': { min: 3, max: 3 },
  has: { min: 2, max: 2 },
  'default-to': { min: 2, max: 2 },
  pick: { min: 2, max: 2 },
  omit: { min: 2, max: 2 },
  defaults: { min: 2 },
  keys: { min: 1, max: 1 },
  values: { min: 1, max: 1 },
  entries: { min: 1, max: 1 },
  map: { min: 2, max: 2 },
  where: { min: 2, max: 2 },
  reject: { min: 2, max: 2 },
  find: { min: 2, max: 2 },
  some: { min: 2, max: 2 },
  every: { min: 2, max: 2 },
  'flat-map': { min: 2, max: 2 },
  flatten: { min: 1, max: 1 },
  uniq: { min: 1, max: 1 },
  'uniq-by': { min: 2, max: 2 },
  concat: { min: 2 },
  take: { min: 1, max: 2 },
  drop: { min: 1, max: 2 },
  'sort-by': { min: 2, max: 2 },
  'group-by': { min: 2, max: 2 },
  'key-by': { min: 2, max: 2 },
  size: { min: 1, max: 1 },
  sum: { min: 1, max: 1 },
  'sum-by': { min: 2, max: 2 },
  min: { min: 1, max: 1 },
  max: { min: 1, max: 1 },
  'min-by': { min: 2, max: 2 },
  'max-by': { min: 2, max: 2 },
  trim: { min: 1, max: 1 },
  'lower-case': { min: 1, max: 1 },
  'upper-case': { min: 1, max: 1 },
  split: { min: 2, max: 2 },
  join: { min: 1, max: 2 },
  match: { min: 2, max: 2 },
  eq: { min: 2, max: 2 },
  ne: { min: 2, max: 2 },
  gt: { min: 2, max: 2 },
  gte: { min: 2, max: 2 },
  lt: { min: 2, max: 2 },
  lte: { min: 2, max: 2 },
  includes: { min: 2, max: 2 },
  or: { min: 1 },
  not: { min: 1, max: 1 },
  'is-nil': { min: 1, max: 1 },
  'is-empty': { min: 1, max: 1 },
  and: { min: 1 },
  between: { min: 3, max: 3 },
  'in-list': { min: 1, max: 2 },
  'in-array': { min: 2, max: 2 },
  'relative-date': { min: 1, max: 1 },
  'relative-date-time': { min: 1, max: 2 },
  'left-join': { min: 2, max: 2 },
  'full-join': { min: 2, max: 2 },
  'join-by': { min: 2 },
  'join-by-any': { min: 2 },
  'join-coalesce': { min: 1, max: 2 },
  'lookup-one': { min: 1, max: 1 },
  'lookup-many': { min: 1, max: 1 },
  enrich: { min: 3, max: 3 },
}

/** Компилирует разрешенное source-expression в безопасный IR. */
export function compileSourceExpression(
  raw: t.Expression | null | undefined,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): SourceExpressionIR | null {
  if (!raw) {
    diagnostics.push(diagnostic('error', 'source-expression-missing', 'Expression отсутствует.', sourcePath))
    return null
  }

  const node = unwrapExpression(raw)

  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node) || t.isNullLiteral(node)) {
    return { type: 'literal', value: literalValue(node) }
  }

  if (t.isIdentifier(node, { name: 'undefined' }))
    return { type: 'literal', value: undefined }

  if (t.isTemplateLiteral(node) && node.expressions.length === 0)
    return { type: 'literal', value: node.quasis[0]?.value.cooked ?? '' }

  if (t.isArrayExpression(node)) {
    const items: SourceExpressionIR[] = []
    for (let index = 0; index < node.elements.length; index++) {
      const element = node.elements[index]
      if (!element || !t.isExpression(element)) {
        diagnostics.push(diagnostic('error', 'source-expression-array-item', 'Array допускает только expression items.', `${sourcePath}.${index}`))
        continue
      }
      const item = compileSourceExpression(element, diagnostics, `${sourcePath}.${index}`)
      if (item)
        items.push(item)
    }
    return { type: 'array', items }
  }

  if (t.isObjectExpression(node)) {
    const properties: Record<string, SourceExpressionIR> = {}
    for (const property of node.properties) {
      if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
        diagnostics.push(diagnostic('error', 'source-expression-object-property', 'Object допускает только обычные properties без spread/computed keys.', sourcePath, property))
        continue
      }
      const key = propertyName(property.key)
      if (!key) {
        diagnostics.push(diagnostic('error', 'source-expression-object-key', 'Не удалось определить имя object property.', sourcePath, property))
        continue
      }
      const value = compileSourceExpression(property.value, diagnostics, `${sourcePath}.${key}`)
      if (value)
        properties[key] = value
    }
    return { type: 'object', properties }
  }

  const filterFieldsRead = compileFilterFieldsRead(node, diagnostics, sourcePath)
  if (filterFieldsRead)
    return filterFieldsRead

  if (t.isCallExpression(node) && t.isMemberExpression(node.callee) && t.isExpression(node.callee.object)) {
    const method = propertyName(node.callee.property)
    const operation = method ? OPERATION_FUNCTIONS[method] : undefined
    if (!operation || !CHAIN_OPERATIONS.has(operation)) {
      diagnostics.push(diagnostic('error', 'source-expression-unsupported', `Метод ".${method ?? ''}" не входит в whitelist value DSL.`, sourcePath, node))
      return null
    }
    const base = compileSourceExpression(node.callee.object, diagnostics, `${sourcePath}.source`)
    if (!base)
      return null
    const args = compileArguments(node, diagnostics, sourcePath, method ?? operation)
    validateArity(operation, args.length + 1, method ?? operation, diagnostics, sourcePath, node)
    return { type: 'operation', operation, arguments: [base, ...args] }
  }

  if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
    const calleeName = node.callee.name
    const readSource = READ_FUNCTIONS[calleeName]
    if (readSource) {
      if (readSource === 'response' && node.arguments.length === 0)
        return { type: 'read', source: readSource, path: '' }
      const path = readStringArgument(node, 0)
      if (path == null) {
        diagnostics.push(diagnostic('error', 'source-expression-read-path', `${node.callee.name}(...) принимает строковый path.`, sourcePath, node))
        return null
      }
      if (node.arguments.length !== 1)
        diagnostics.push(diagnostic('error', 'source-expression-read-arity', `${calleeName}(...) принимает ровно один path.`, sourcePath, node))
      return { type: 'read', source: readSource, path }
    }

    const domainRead = compileDomainRead(node, diagnostics, sourcePath)
    if (domainRead)
      return domainRead

    const operation = OPERATION_FUNCTIONS[calleeName]
    if (operation) {
      const args = compileArguments(node, diagnostics, sourcePath, calleeName)
      if (IMPLICIT_CURRENT_OPERATIONS.has(operation))
        args.unshift({ type: 'read', source: 'current', path: '' })
      validateArity(operation, args.length, calleeName, diagnostics, sourcePath, node)
      return { type: 'operation', operation, arguments: args }
    }
  }

  diagnostics.push(diagnostic(
    'error',
    'source-expression-unsupported',
    'Expression не входит в безопасный whitelist source DSL.',
    sourcePath,
    node,
  ))
  return null
}

function compileFilterFieldsRead(
  node: t.Expression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): SourceExpressionIR | null {
  if (!t.isCallExpression(node) || !t.isMemberExpression(node.callee) || propertyName(node.callee.property) !== 'fields')
    return null
  const base = unwrapExpression(node.callee.object)
  if (!t.isCallExpression(base) || !t.isIdentifier(base.callee, { name: 'fromFilter' }))
    return null
  const runtime = readStringArgument(base, 0)
  const fieldsArg = node.arguments[0]
  const fields = fieldsArg && t.isArrayExpression(fieldsArg)
    ? fieldsArg.elements.map(item => item && t.isStringLiteral(item) ? item.value : null)
    : []
  if (!runtime || fields.length === 0 || fields.some(field => field == null)) {
    diagnostics.push(diagnostic('error', 'source-expression-filter-fields', 'fromFilter(runtime).fields([...]) требует runtime и массив строк.', sourcePath, node))
    return { type: 'literal', value: undefined }
  }
  return { type: 'read', source: 'composition-filter-fields', path: '', parameters: [runtime, ...(fields as string[])] }
}

/** Публичный alias: SourceExpression и ValueExpression используют один compiler. */
export const compileValueExpression = compileSourceExpression

function compileArguments(
  node: t.CallExpression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
  name: string,
): SourceExpressionIR[] {
  const args: SourceExpressionIR[] = []
  node.arguments.forEach((argument, index) => {
    if (!t.isExpression(argument)) {
      diagnostics.push(diagnostic('error', 'source-expression-operation-argument', `${name}(...) не поддерживает spread arguments.`, `${sourcePath}.${index}`))
      return
    }
    const compiled = compileSourceExpression(argument, diagnostics, `${sourcePath}.${index}`)
    if (compiled)
      args.push(compiled)
  })
  return args
}

function validateArity(
  operation: SourceExpressionOperation,
  count: number,
  name: string,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
  node: t.Node,
): void {
  const arity = OPERATION_ARITY[operation]
  if (count < arity.min || (arity.max != null && count > arity.max))
    diagnostics.push(diagnostic('error', 'source-expression-operation-arity', `${name}(...) получил недопустимое число arguments.`, sourcePath, node))
}

function compileDomainRead(
  node: t.CallExpression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): SourceExpressionIR | null {
  if (!t.isIdentifier(node.callee))
    return null
  const name = node.callee.name
  const specs: Record<string, { source: SourceExpressionReadKind, count: number }> = {
    fromOutput: { source: 'composition-output', count: 2 },
    fromData: { source: 'composition-data', count: 1 },
    fromStore: { source: 'composition-store', count: 1 },
    metadata: { source: 'metadata', count: 2 },
  }
  const spec = specs[name]
  if (!spec)
    return null
  const parameters = Array.from({ length: spec.count }, (_, index) => readStringArgument(node, index))
  if (node.arguments.length !== spec.count || parameters.some(value => value == null)) {
    diagnostics.push(diagnostic('error', 'source-expression-domain-read', `${name}(...) требует ${spec.count} строковых arguments.`, sourcePath, node))
    return { type: 'literal', value: undefined }
  }
  return { type: 'read', source: spec.source, path: '', parameters: parameters as string[] }
}

/** Извлекает expression-body из arrow/function callback и компилирует его в IR. */
export function compileSourceCallback(
  raw: t.CallExpression['arguments'][number] | undefined,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): SourceExpressionIR | null {
  if (!raw || !t.isExpression(raw)) {
    diagnostics.push(diagnostic('error', 'source-callback-missing', 'Ожидается callback expression.', sourcePath))
    return null
  }

  const callback = unwrapExpression(raw)
  if (!t.isArrowFunctionExpression(callback) && !t.isFunctionExpression(callback)) {
    diagnostics.push(diagnostic('error', 'source-callback-shape', 'Ожидается arrow/function callback.', sourcePath, callback))
    return null
  }

  if (t.isBlockStatement(callback.body)) {
    diagnostics.push(diagnostic('error', 'source-callback-block-unsupported', 'Callback с block body не поддерживается; верните expression напрямую.', sourcePath, callback.body))
    return null
  }

  return compileSourceExpression(callback.body, diagnostics, sourcePath)
}

/** Снимает TS/parentheses wrappers с AST expression. */
export function unwrapExpression<T extends t.Node>(node: T): T {
  let current: t.Node = node
  while (
    t.isTSAsExpression(current)
    || t.isTSTypeAssertion(current)
    || t.isTSNonNullExpression(current)
    || t.isParenthesizedExpression(current)
  ) {
    current = current.expression
  }
  return current as T
}

export function propertyName(node: t.Node): string | null {
  if (t.isIdentifier(node))
    return node.name
  if (t.isStringLiteral(node) || t.isNumericLiteral(node))
    return String(node.value)
  return null
}

export function readStringArgument(node: t.CallExpression, index: number): string | null {
  const argument = node.arguments[index]
  return argument && t.isStringLiteral(argument) ? argument.value : null
}

export function diagnostic(
  severity: DiagnosticDraft['severity'],
  code: string,
  message: string,
  sourcePath?: string,
  node?: t.Node | null,
): DiagnosticDraft {
  return {
    severity,
    code,
    message,
    sourcePath,
    start: typeof node?.start === 'number' ? node.start : undefined,
    end: typeof node?.end === 'number' ? node.end : undefined,
  }
}

function literalValue(node: t.StringLiteral | t.NumericLiteral | t.BooleanLiteral | t.NullLiteral): unknown {
  if (t.isNullLiteral(node))
    return null
  return node.value
}
