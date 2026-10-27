import type { ProgramDiagnostic } from '@/features/core/modules/program/domain/types/program.types'
import type { SourceContextPattern, SourceContextValues } from '@/features/core/modules/source/domain/types/source-context.types'

import type {
  SourceExpressionIR,
  SourceExpressionOperation,
  SourceExpressionReadKind,
} from '@/features/core/modules/source/domain/types/source-expression.types'

import * as t from '@babel/types'

import {
  findAmbiguousContextCases,
  getSourceContext,
  matchesContextPattern,
  selectContextCase,
} from '@/features/core/modules/source/services/source-context'
import { readValuePath, validateValuePath } from '@/features/core/modules/source/services/value-path'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

// Функции контекста сборки: значения фасетов и Configuration фиксированы на boot и подставляются при компиляции.
const CONTEXT_FUNCTIONS = new Set(['facet', 'config', 'context', 'contextSwitch'])

// Коды диагностик условия context(...) и when у contextSwitch значений.
const CONTEXT_PATTERN_CODES = {
  entry: 'source-expression-context-entry',
  duplicate: 'source-expression-context-duplicate',
} as const

const CONTEXT_SWITCH_PATTERN_CODES = {
  entry: 'source-expression-context-switch-when-entry',
  duplicate: 'source-expression-context-switch-when-duplicate',
} as const

const READ_FUNCTIONS: Record<string, SourceExpressionReadKind> = {
  env: 'env',
  endgeVar: 'env',
  prop: 'prop',
  value: 'value',
  row: 'row',
  response: 'response',
  store: 'store',
  path: 'scope',
  __computationOutput: 'computation-output',
  // Внутренняя форма reader errors(path?) GraphQL Query; публичное имя переписывает компилятор Query.
  __graphqlErrors: 'graphql-errors',
}

const OPERATION_FUNCTIONS: Record<string, SourceExpressionOperation> = Object.assign(Object.create(null), {
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
  when: 'when',
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
  choose: 'choose',
  lookupValue: 'lookup-value',
  toString: 'to-string',
  toNumber: 'to-number',
  toBoolean: 'to-boolean',
  typeOf: 'type-of',
  isString: 'is-string',
  isNumber: 'is-number',
  isBoolean: 'is-boolean',
  isArray: 'is-array',
  isObject: 'is-object',
  isDateTime: 'is-date-time',
  isDuration: 'is-duration',
  add: 'add',
  subtract: 'subtract',
  multiply: 'multiply',
  divide: 'divide',
  modulo: 'modulo',
  abs: 'abs',
  negate: 'negate',
  round: 'round',
  floor: 'floor',
  ceil: 'ceil',
  clamp: 'clamp',
  average: 'average',
  averageBy: 'average-by',
  startsWith: 'starts-with',
  endsWith: 'ends-with',
  replace: 'replace',
  replaceAll: 'replace-all',
  slice: 'slice',
  padStart: 'pad-start',
  padEnd: 'pad-end',
  normalizeWhitespace: 'normalize-whitespace',
  set: 'set',
  unset: 'unset',
  rename: 'rename',
  getKey: 'get-key',
  fromEntries: 'from-entries',
  first: 'first',
  last: 'last',
  at: 'at',
  reverse: 'reverse',
  sortByDesc: 'sort-by-desc',
  orderBy: 'order-by',
  chunk: 'chunk',
  union: 'union',
  intersection: 'intersection',
  difference: 'difference',
  countBy: 'count-by',
  dateTime: 'date-time',
  duration: 'duration',
  dateTimeAdd: 'date-time-add',
  dateTimeSubtract: 'date-time-subtract',
  dateTimeDifference: 'date-time-difference',
  dateTimeStartOf: 'date-time-start-of',
  dateTimeEndOf: 'date-time-end-of',
  dateTimePart: 'date-time-part',
  durationAdd: 'duration-add',
  durationSubtract: 'duration-subtract',
  durationTotal: 'duration-total',
  containsAll: 'contains-all',
  containsAny: 'contains-any',
})

const FUNCTION_OPERATION_OVERRIDES: Record<string, SourceExpressionOperation> = {
  coalesce: 'coalesce',
}

const IMPLICIT_CURRENT_OPERATIONS = new Set<SourceExpressionOperation>([
  'get',
  'get-or',
  'has',
  'pick',
  'omit',
  'match',
  'is-nil',
  'is-empty',
])

const CHAIN_OPERATIONS = new Set(Object.values(OPERATION_FUNCTIONS))

// Readers, второй аргумент которых — путь value DSL (env и computation-output читают имя, а не путь).
const PATH_READ_SOURCES = new Set<SourceExpressionReadKind>(['prop', 'value', 'row', 'response', 'store', 'scope', 'graphql-errors'])

// Операции, второй аргумент которых — путь чтения value DSL.
const PATH_OPERATIONS = new Set<SourceExpressionOperation>(['get', 'get-or', 'has', 'pick'])

const OPERATION_ARITY: Record<SourceExpressionOperation, { min: number, max?: number }> = {
  'merge': { min: 2 },
  'compact': { min: 1, max: 1 },
  'get': { min: 2, max: 2 },
  'get-or': { min: 3, max: 3 },
  'has': { min: 2, max: 2 },
  'default-to': { min: 2, max: 2 },
  'pick': { min: 2, max: 2 },
  'omit': { min: 2, max: 2 },
  'defaults': { min: 2 },
  'keys': { min: 1, max: 1 },
  'values': { min: 1, max: 1 },
  'entries': { min: 1, max: 1 },
  'map': { min: 2, max: 2 },
  'where': { min: 2, max: 2 },
  'reject': { min: 2, max: 2 },
  'find': { min: 2, max: 2 },
  'some': { min: 2, max: 2 },
  'every': { min: 2, max: 2 },
  'flat-map': { min: 2, max: 2 },
  'flatten': { min: 1, max: 1 },
  'uniq': { min: 1, max: 1 },
  'uniq-by': { min: 2, max: 2 },
  'concat': { min: 2 },
  'take': { min: 1, max: 2 },
  'drop': { min: 1, max: 2 },
  'sort-by': { min: 2, max: 2 },
  'group-by': { min: 2, max: 2 },
  'key-by': { min: 2, max: 2 },
  'size': { min: 1, max: 1 },
  'sum': { min: 1, max: 1 },
  'sum-by': { min: 2, max: 2 },
  'min': { min: 1, max: 1 },
  'max': { min: 1, max: 1 },
  'min-by': { min: 2, max: 2 },
  'max-by': { min: 2, max: 2 },
  'trim': { min: 1, max: 1 },
  'lower-case': { min: 1, max: 1 },
  'upper-case': { min: 1, max: 1 },
  'split': { min: 2, max: 2 },
  'join': { min: 1, max: 2 },
  'match': { min: 2, max: 2 },
  'eq': { min: 2, max: 2 },
  'ne': { min: 2, max: 2 },
  'gt': { min: 2, max: 2 },
  'gte': { min: 2, max: 2 },
  'lt': { min: 2, max: 2 },
  'lte': { min: 2, max: 2 },
  'includes': { min: 2, max: 2 },
  'or': { min: 1 },
  'when': { min: 3, max: 3 },
  'not': { min: 1, max: 1 },
  'is-nil': { min: 1, max: 1 },
  'is-empty': { min: 1, max: 1 },
  'and': { min: 1 },
  'between': { min: 3, max: 3 },
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
  'enrich': { min: 3, max: 3 },
  'coalesce': { min: 1 },
  'choose': { min: 2, max: 2 },
  'lookup-value': { min: 2, max: 3 },
  'to-string': { min: 1, max: 1 },
  'to-number': { min: 1, max: 2 },
  'to-boolean': { min: 1, max: 2 },
  'type-of': { min: 1, max: 1 },
  'is-string': { min: 1, max: 1 },
  'is-number': { min: 1, max: 1 },
  'is-boolean': { min: 1, max: 1 },
  'is-array': { min: 1, max: 1 },
  'is-object': { min: 1, max: 1 },
  'is-date-time': { min: 1, max: 1 },
  'is-duration': { min: 1, max: 1 },
  'add': { min: 2 },
  'subtract': { min: 2, max: 2 },
  'multiply': { min: 2 },
  'divide': { min: 2, max: 2 },
  'modulo': { min: 2, max: 2 },
  'abs': { min: 1, max: 1 },
  'negate': { min: 1, max: 1 },
  'round': { min: 1, max: 2 },
  'floor': { min: 1, max: 1 },
  'ceil': { min: 1, max: 1 },
  'clamp': { min: 3, max: 3 },
  'average': { min: 1, max: 1 },
  'average-by': { min: 2, max: 2 },
  'starts-with': { min: 2, max: 2 },
  'ends-with': { min: 2, max: 2 },
  'replace': { min: 3, max: 3 },
  'replace-all': { min: 3, max: 3 },
  'slice': { min: 2, max: 3 },
  'pad-start': { min: 2, max: 3 },
  'pad-end': { min: 2, max: 3 },
  'normalize-whitespace': { min: 1, max: 1 },
  'set': { min: 3, max: 3 },
  'unset': { min: 2, max: 2 },
  'rename': { min: 3, max: 3 },
  'get-key': { min: 2, max: 2 },
  'from-entries': { min: 1, max: 1 },
  'first': { min: 1, max: 1 },
  'last': { min: 1, max: 1 },
  'at': { min: 2, max: 2 },
  'reverse': { min: 1, max: 1 },
  'sort-by-desc': { min: 2, max: 2 },
  'order-by': { min: 2, max: 2 },
  'chunk': { min: 2, max: 2 },
  'union': { min: 2 },
  'intersection': { min: 2, max: 2 },
  'difference': { min: 2, max: 2 },
  'count-by': { min: 2, max: 2 },
  'date-time': { min: 1, max: 1 },
  'duration': { min: 1, max: 1 },
  'date-time-add': { min: 2, max: 2 },
  'date-time-subtract': { min: 2, max: 2 },
  'date-time-difference': { min: 2, max: 2 },
  'date-time-start-of': { min: 2, max: 2 },
  'date-time-end-of': { min: 2, max: 2 },
  'date-time-part': { min: 2, max: 2 },
  'duration-add': { min: 2 },
  'duration-subtract': { min: 2, max: 2 },
  'duration-total': { min: 2, max: 2 },
  'contains-all': { min: 2, max: 2 },
  'contains-any': { min: 2, max: 2 },
}

// Компилирует разрешенное source-expression в безопасный IR.
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

  if (t.isUnaryExpression(node) && (node.operator === '-' || node.operator === '+') && t.isNumericLiteral(node.argument)) {
    return {
      type: 'literal',
      value: node.operator === '-' ? -node.argument.value : node.argument.value,
    }
  }

  if (t.isIdentifier(node, { name: 'undefined' })) {
    return { type: 'literal', value: undefined }
  }

  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return { type: 'literal', value: node.quasis[0]?.value.cooked ?? '' }
  }

  if (t.isArrayExpression(node)) {
    const items: SourceExpressionIR[] = []
    for (let index = 0; index < node.elements.length; index++) {
      const element = node.elements[index]
      if (!element || !t.isExpression(element)) {
        diagnostics.push(diagnostic('error', 'source-expression-array-item', 'Array допускает только expression items.', `${sourcePath}.${index}`))
        continue
      }
      const item = compileSourceExpression(element, diagnostics, `${sourcePath}.${index}`)
      if (item) {
        items.push(item)
      }
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
      if (value) {
        properties[key] = value
      }
    }
    return { type: 'object', properties }
  }

  const filterFieldsRead = compileFilterFieldsRead(node, diagnostics, sourcePath)
  if (filterFieldsRead) {
    return filterFieldsRead
  }

  if (t.isCallExpression(node) && t.isMemberExpression(node.callee) && t.isExpression(node.callee.object)) {
    const method = propertyName(node.callee.property)
    if (method === 'dataView' || method === 'convert') {
      const base = compileSourceExpression(node.callee.object, diagnostics, `${sourcePath}.source`)
      const identity = readStringArgument(node, 0)
      const optionsNode = node.arguments[1]
      const options = optionsNode && t.isExpression(optionsNode)
        ? compileSourceExpression(optionsNode, diagnostics, `${sourcePath}.options`)
        : undefined
      if (!base || !identity || node.arguments.length < 1 || node.arguments.length > 2) {
        diagnostics.push(diagnostic('error', 'source-expression-transform', `.${method}(identity, options?) требует static identity.`, sourcePath, node))
        return null
      }
      return {
        type: 'transform',
        transform: method === 'dataView' ? 'data-view' : 'converter',
        identity,
        input: base,
        ...(options ? { options } : {}),
      }
    }
    const operation = method ? OPERATION_FUNCTIONS[method] : undefined
    if (!operation || !CHAIN_OPERATIONS.has(operation)) {
      diagnostics.push(diagnostic('error', 'source-expression-unsupported', `Метод ".${method ?? ''}" не входит в whitelist value DSL.`, sourcePath, node))
      return null
    }
    const base = compileSourceExpression(node.callee.object, diagnostics, `${sourcePath}.source`)
    if (!base) {
      return null
    }
    const args = compileArguments(node, diagnostics, sourcePath, method ?? operation)
    validateArity(operation, args.length + 1, method ?? operation, diagnostics, sourcePath, node)
    validateOperationPath(operation, [base, ...args], diagnostics, sourcePath, node)
    return { type: 'operation', operation, arguments: [base, ...args] }
  }

  if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
    const calleeName = node.callee.name
    if (CONTEXT_FUNCTIONS.has(calleeName)) {
      return compileContextCall(node, calleeName, diagnostics, sourcePath)
    }
    const updateRead = compileUpdateRead(node, diagnostics, sourcePath)
    if (updateRead) {
      return updateRead
    }
    const readSource = Object.hasOwn(READ_FUNCTIONS, calleeName)
      ? READ_FUNCTIONS[calleeName]
      : undefined
    if (readSource) {
      if ((readSource === 'response' || readSource === 'graphql-errors') && node.arguments.length === 0) {
        return { type: 'read', source: readSource, path: '' }
      }
      const path = readStringArgument(node, 0)
      if (path == null) {
        diagnostics.push(diagnostic('error', 'source-expression-read-path', `${node.callee.name}(...) принимает строковый path.`, sourcePath, node))
        return null
      }
      if (node.arguments.length !== 1) {
        diagnostics.push(diagnostic('error', 'source-expression-read-arity', `${calleeName}(...) принимает ровно один path.`, sourcePath, node))
      }
      if (PATH_READ_SOURCES.has(readSource)) {
        validateSourcePath(path, diagnostics, sourcePath, node.arguments[0])
      }
      return { type: 'read', source: readSource, path }
    }

    const domainRead = compileDomainRead(node, diagnostics, sourcePath)
    if (domainRead) {
      return domainRead
    }

    const operation = Object.hasOwn(FUNCTION_OPERATION_OVERRIDES, calleeName)
      ? FUNCTION_OPERATION_OVERRIDES[calleeName]
      : OPERATION_FUNCTIONS[calleeName]
    if (operation) {
      const args = compileArguments(node, diagnostics, sourcePath, calleeName)
      const arity = OPERATION_ARITY[operation]
      if (IMPLICIT_CURRENT_OPERATIONS.has(operation) && args.length < arity.min) {
        args.unshift({ type: 'read', source: 'current', path: '' })
      }
      validateArity(operation, args.length, calleeName, diagnostics, sourcePath, node)
      validateOperationPath(operation, args, diagnostics, sourcePath, node)
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

// Компилирует facet/config/context/contextSwitch в константу IR по контексту текущей сборки.
// Вне сборки (редактор, изолированный compile) подставляется значение по умолчанию и info-диагностика.
function compileContextCall(
  node: t.CallExpression,
  name: string,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): SourceExpressionIR | null {
  const context = getSourceContext()
  if (name === 'contextSwitch') {
    return compileContextSwitch(node, diagnostics, sourcePath, context)
  }
  if (!context) {
    pushContextUnbound(name, diagnostics, sourcePath, node)
  }

  if (name === 'facet') {
    const identity = readStringArgument(node, 0)?.trim()
    if (node.arguments.length !== 1 || !identity) {
      diagnostics.push(diagnostic('error', 'source-expression-facet-argument', 'facet(...) принимает одну непустую строку — identity фасета.', sourcePath, node))
      return { type: 'literal', value: null }
    }
    if (context?.knownFacets && !context.knownFacets.includes(identity)) {
      diagnostics.push(diagnostic('warning', 'source-expression-facet-unknown', `Фасет "${identity}" не объявлен в домене (активные: ${context.knownFacets.join(', ') || 'нет'}); facet(...) вернёт null.`, sourcePath, node))
    }
    return { type: 'literal', value: context?.facets[identity] ?? null }
  }

  if (name === 'config') {
    const path = readStringArgument(node, 0)
    if (node.arguments.length !== 1 || path == null || !path.trim()) {
      diagnostics.push(diagnostic('error', 'source-expression-config-argument', 'config(...) принимает одну непустую строку — путь в effective Configuration.', sourcePath, node))
      return { type: 'literal', value: undefined }
    }
    validateSourcePath(path, diagnostics, sourcePath, node.arguments[0])
    return { type: 'literal', value: context ? toPlainValue(readValuePath(context.config, path, {})) : undefined }
  }

  const patternNode = node.arguments[0] && t.isExpression(node.arguments[0]) ? unwrapExpression(node.arguments[0]) : null
  if (node.arguments.length !== 1 || !patternNode || !t.isObjectExpression(patternNode)) {
    diagnostics.push(diagnostic('error', 'source-expression-context-shape', 'context(...) принимает один object literal { фасет: \'документ\' }.', sourcePath, node))
    return { type: 'literal', value: false }
  }
  const pattern = readContextPatternNode(patternNode, diagnostics, sourcePath, CONTEXT_PATTERN_CODES)
  if (!Object.keys(pattern).length) {
    diagnostics.push(diagnostic('error', 'source-expression-context-empty', 'context(...) требует хотя бы одно условие фасета.', sourcePath, patternNode))
    return { type: 'literal', value: false }
  }
  return { type: 'literal', value: context ? matchesContextPattern(pattern, context.facets) : false }
}

// contextSwitch для значений: все ветки компилируются и проверяются, в IR остаётся выбранная.
function compileContextSwitch(
  node: t.CallExpression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
  context: SourceContextValues | undefined,
): SourceExpressionIR | null {
  const parsed = readContextSwitchNode(node, diagnostics, `${sourcePath}.contextSwitch`, compileSourceExpression)
  if (!parsed) {
    return null
  }
  if (!context) {
    pushContextUnbound('contextSwitch', diagnostics, sourcePath, node)
    return parsed.defaultValue
  }
  const selected = selectContextCase(parsed.branches, context.facets)
  return selected == null ? parsed.defaultValue : parsed.branches[selected]!.value
}

// Разобранный contextSwitch: значение default и ветки с условиями в порядке Source.
export interface ContextSwitchNode<T> {
  defaultValue: T
  branches: Array<{ when: SourceContextPattern, value: T, node: t.Node }>
}

// Общий разбор contextSwitch({ default, cases: [{ when, use }] }) для значений и GraphQL fragments:
// форма, условия when, неоднозначные cases. readBranch читает default и каждый use.
export function readContextSwitchNode<T>(
  node: t.CallExpression,
  diagnostics: DiagnosticDraft[],
  switchPath: string,
  readBranch: (node: t.Expression, diagnostics: DiagnosticDraft[], sourcePath: string) => T,
): ContextSwitchNode<T> | null {
  const definition = node.arguments[0] && t.isExpression(node.arguments[0]) ? unwrapExpression(node.arguments[0]) : null
  if (node.arguments.length !== 1 || !definition || !t.isObjectExpression(definition)) {
    diagnostics.push(diagnostic('error', 'source-expression-context-switch-shape', 'contextSwitch принимает один object literal с default и cases.', switchPath, node))
    return null
  }

  const seen = new Set<string>()
  for (const property of definition.properties) {
    const key = t.isObjectProperty(property) && !property.computed && !property.shorthand ? propertyName(property.key) : null
    if (!key || !t.isObjectProperty(property) || !t.isExpression(property.value)) {
      diagnostics.push(diagnostic('error', 'source-expression-context-switch-property', 'contextSwitch допускает только явные свойства default и cases.', switchPath, property))
      continue
    }
    if (key !== 'default' && key !== 'cases') {
      diagnostics.push(diagnostic('error', 'source-expression-context-switch-property', `Свойство "${key}" не поддерживается contextSwitch.`, switchPath, property))
      continue
    }
    if (seen.has(key)) {
      diagnostics.push(diagnostic('error', 'source-expression-context-switch-property', `Свойство "${key}" указано повторно.`, `${switchPath}.${key}`, property))
    }
    seen.add(key)
  }

  const defaultNode = objectPropertyValue(definition, 'default')
  const casesNode = objectPropertyValue(definition, 'cases')
  if (!defaultNode) {
    diagnostics.push(diagnostic('error', 'source-expression-context-switch-default-required', 'contextSwitch требует default.', `${switchPath}.default`, definition))
  }
  if (!casesNode || !t.isArrayExpression(casesNode)) {
    diagnostics.push(diagnostic('error', 'source-expression-context-switch-cases-shape', 'contextSwitch.cases должен быть массивом { when, use }.', `${switchPath}.cases`, casesNode ?? definition))
  }
  if (!defaultNode || !casesNode || !t.isArrayExpression(casesNode)) {
    return null
  }

  const defaultValue = readBranch(defaultNode, diagnostics, `${switchPath}.default`)
  const branches: ContextSwitchNode<T>['branches'] = []
  for (const [index, element] of casesNode.elements.entries()) {
    const branchPath = `${switchPath}.cases.${index}`
    if (!element || !t.isObjectExpression(element)) {
      diagnostics.push(diagnostic('error', 'source-expression-context-switch-case-shape', 'Каждый case должен иметь вид { when: {...}, use: значение }.', branchPath, element ?? casesNode))
      continue
    }
    for (const property of element.properties) {
      const key = t.isObjectProperty(property) && !property.computed ? propertyName(property.key) : null
      if (key !== 'when' && key !== 'use') {
        diagnostics.push(diagnostic('error', 'source-expression-context-switch-case-shape', 'Case contextSwitch допускает только when и use.', branchPath, property))
      }
    }
    const whenNode = objectPropertyValue(element, 'when')
    const useNode = objectPropertyValue(element, 'use')
    if (!whenNode || !t.isObjectExpression(whenNode)) {
      diagnostics.push(diagnostic('error', 'source-expression-context-switch-when-shape', 'case.when должен быть object literal { фасет: \'документ\' }.', `${branchPath}.when`, whenNode ?? element))
      continue
    }
    const when = readContextPatternNode(whenNode, diagnostics, `${branchPath}.when`, CONTEXT_SWITCH_PATTERN_CODES)
    if (!Object.keys(when).length) {
      diagnostics.push(diagnostic('error', 'source-expression-context-switch-when-empty', 'Пустой when недопустим: используйте default.', `${branchPath}.when`, whenNode))
      continue
    }
    if (!useNode) {
      diagnostics.push(diagnostic('error', 'source-expression-context-switch-use-required', 'case.use должен содержать значение.', `${branchPath}.use`, element))
      continue
    }
    branches.push({ when, value: readBranch(useNode, diagnostics, `${branchPath}.use`), node: element })
  }

  for (const [left, right] of findAmbiguousContextCases(branches)) {
    diagnostics.push(diagnostic(
      'error',
      'source-expression-context-switch-ambiguous',
      `Cases ${left} и ${right} пересекаются с одинаковой специфичностью; порядок строк не задаёт приоритет.`,
      `${switchPath}.cases.${right}`,
      branches[right]!.node,
    ))
  }

  return { defaultValue, branches }
}

// contextSwitch в позиции ссылки (Type, DataView, provider порта SFC): все ветки читаются и проверяются
// readBranch, выбирается ветка по фасетам сборки общим matcher. variants — default и все cases по порядку.
// Вне сборки — default и info source-expression-context-unbound. null — ошибка формы или ветки.
export function selectContextSwitchNode<T>(
  node: t.CallExpression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
  readBranch: (node: t.Expression, diagnostics: DiagnosticDraft[], sourcePath: string) => T | null,
): { selected: T, variants: T[] } | null {
  const parsed = readContextSwitchNode<T | null>(node, diagnostics, `${sourcePath}.contextSwitch`, readBranch)
  if (!parsed || parsed.defaultValue == null || parsed.branches.some(branch => branch.value == null)) {
    return null
  }
  const context = getSourceContext()
  if (!context) {
    pushContextUnbound('contextSwitch', diagnostics, sourcePath, node)
  }
  const index = context ? selectContextCase(parsed.branches, context.facets) : null
  const variants = [parsed.defaultValue, ...parsed.branches.map(branch => branch.value)] as T[]
  return { selected: index == null ? parsed.defaultValue : parsed.branches[index]!.value as T, variants }
}

// Проверяет, что выражение — вызов contextSwitch(...).
export function isContextSwitchCall(node: t.Node | null | undefined): boolean {
  return node != null && t.isCallExpression(node) && t.isIdentifier(node.callee, { name: 'contextSwitch' })
}

// Читает условие фасетов { facet: 'document' } из object literal; ключи и значения — непустые строки.
export function readContextPatternNode(
  node: t.ObjectExpression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
  codes: { entry: string, duplicate: string },
): Record<string, string> {
  const result: Record<string, string> = Object.create(null)
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || property.shorthand || !t.isStringLiteral(property.value)) {
      diagnostics.push(diagnostic('error', codes.entry, 'when допускает только пары context-key: string identity.', sourcePath, property))
      continue
    }
    const key = propertyName(property.key)?.trim() ?? ''
    const value = property.value.value.trim()
    if (!key || !value) {
      diagnostics.push(diagnostic('error', codes.entry, 'Context key и identity не должны быть пустыми.', sourcePath, property))
      continue
    }
    if (Object.hasOwn(result, key)) {
      diagnostics.push(diagnostic('error', codes.duplicate, `Context key "${key}" указан повторно.`, `${sourcePath}.${key}`, property))
      continue
    }
    result[key] = value
    warnUnknownFacet(key, diagnostics, `${sourcePath}.${key}`, property)
  }
  return result
}

// Предупреждение о фасете, которого нет среди активных фасетов домена (только при сборке со списком фасетов).
function warnUnknownFacet(identity: string, diagnostics: DiagnosticDraft[], sourcePath: string, node: t.Node): void {
  const knownFacets = getSourceContext()?.knownFacets
  if (knownFacets && !knownFacets.includes(identity)) {
    diagnostics.push(diagnostic('warning', 'source-expression-facet-unknown', `Фасет "${identity}" не объявлен в домене (активные: ${knownFacets.join(', ') || 'нет'}); условие с ним никогда не совпадёт.`, sourcePath, node))
  }
}

// Одна info-диагностика на документ: остальные вызовы того же Source ведут себя так же.
export function pushContextUnbound(name: string, diagnostics: DiagnosticDraft[], sourcePath: string, node: t.Node): void {
  if (diagnostics.some(item => item.code === 'source-expression-context-unbound')) {
    return
  }
  diagnostics.push(diagnostic(
    'info',
    'source-expression-context-unbound',
    `${name}(...) подставляется при сборке программы по выбранным фасетам; без контекста сборки используется значение по умолчанию.`,
    sourcePath,
    node,
  ))
}

function objectPropertyValue(node: t.ObjectExpression, name: string): t.Expression | null {
  for (const property of node.properties) {
    if (t.isObjectProperty(property) && !property.computed && propertyName(property.key) === name && t.isExpression(property.value)) {
      return unwrapExpression(property.value)
    }
  }
  return null
}

// Копирует значение Configuration в простой JSON-объект для литерала IR (snapshot заморожен).
function toPlainValue(value: unknown): unknown {
  if (value === undefined || value === null || typeof value !== 'object') {
    return value
  }
  try {
    return structuredClone(value)
  }
  catch {
    return value
  }
}

// Проверяет литеральный путь value DSL грамматикой DataPath Raph при компиляции.
export function validateSourcePath(
  path: string,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
  node?: t.Node | null,
): void {
  const issue = validateValuePath(path)
  if (!issue) {
    return
  }
  diagnostics.push(diagnostic(
    'error',
    issue.code === 'value-path-wildcard' ? 'source-expression-path-wildcard' : 'source-expression-path-invalid',
    issue.message,
    sourcePath,
    node,
  ))
}

// Литеральный путь get/getOr/has/pick проверяется сразу; путь из выражения — при вычислении.
function validateOperationPath(
  operation: SourceExpressionOperation,
  args: SourceExpressionIR[],
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
  node: t.Node,
): void {
  const path = args[1]
  if (PATH_OPERATIONS.has(operation) && path?.type === 'literal' && typeof path.value === 'string') {
    validateSourcePath(path.value, diagnostics, sourcePath, node)
  }
}

function compileUpdateRead(
  node: t.CallExpression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): SourceExpressionIR | null {
  if (!t.isIdentifier(node.callee)) {
    return null
  }
  const specs: Record<string, { source: SourceExpressionReadKind, arity: number }> = {
    __updateInput: { source: 'update-input', arity: 1 },
    __updateItem: { source: 'update-item', arity: 1 },
    __updateParent: { source: 'update-parent', arity: 1 },
    __updateData: { source: 'update-data', arity: 1 },
    __updateMeta: { source: 'update-meta', arity: 2 },
    __updateHasData: { source: 'update-has-data', arity: 1 },
    __updateHasMeta: { source: 'update-has-meta', arity: 2 },
  }
  if (!Object.hasOwn(specs, node.callee.name)) {
    return null
  }
  const spec = specs[node.callee.name]!
  const parameters = node.arguments.map((_, index) => readStringArgument(node, index))
  if (parameters.length !== spec.arity || parameters.some(value => value == null)) {
    diagnostics.push(diagnostic('error', 'update-expression-read', 'Update read принимает только ожидаемые строковые arguments.', sourcePath, node))
    return { type: 'literal', value: undefined }
  }
  return {
    type: 'read',
    source: spec.source,
    path: parameters[0]!,
    ...(parameters.length > 1 ? { parameters: parameters.slice(1) as string[] } : {}),
  }
}

function compileFilterFieldsRead(
  node: t.Expression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): SourceExpressionIR | null {
  if (!t.isCallExpression(node) || !t.isMemberExpression(node.callee) || propertyName(node.callee.property) !== 'fields') {
    return null
  }
  const base = unwrapExpression(node.callee.object)
  if (!t.isCallExpression(base) || !t.isIdentifier(base.callee, { name: 'fromFilter' })) {
    return null
  }
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

// Публичный alias: SourceExpression и ValueExpression используют один compiler.
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
    if (compiled) {
      args.push(compiled)
    }
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
  if (count < arity.min || (arity.max != null && count > arity.max)) {
    diagnostics.push(diagnostic('error', 'source-expression-operation-arity', `${name}(...) получил недопустимое число arguments.`, sourcePath, node))
  }
}

function compileDomainRead(
  node: t.CallExpression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): SourceExpressionIR | null {
  if (!t.isIdentifier(node.callee)) {
    return null
  }
  const name = node.callee.name
  const specs: Record<string, { source: SourceExpressionReadKind, min: number, max: number }> = {
    fromOutput: { source: 'composition-output', min: 1, max: 2 },
    metadataOf: { source: 'composition-runtime-metadata', min: 1, max: 2 },
    fromData: { source: 'composition-data', min: 1, max: 1 },
    fromStore: { source: 'composition-store', min: 1, max: 1 },
    metadata: { source: 'metadata', min: 2, max: 2 },
  }
  const spec = Object.hasOwn(specs, name) ? specs[name] : undefined
  if (!spec) {
    return null
  }
  const parameters = node.arguments.map((_, index) => readStringArgument(node, index))
  const invalidArity = node.arguments.length < spec.min || node.arguments.length > spec.max
  const requiresNonEmptyStrings = name === 'fromOutput' || name === 'metadataOf'
  const invalidParameters = parameters.some(value => value == null || (requiresNonEmptyStrings && !value))
  if (invalidArity || invalidParameters) {
    const expected = spec.min === spec.max
      ? `${spec.min} строковых arguments`
      : 'одну или две непустые строки'
    diagnostics.push(diagnostic('error', 'source-expression-domain-read', `${name}(...) требует ${expected}.`, sourcePath, node))
    return { type: 'literal', value: undefined }
  }
  return {
    type: 'read',
    source: name === 'fromOutput' && parameters.length === 1
      ? 'composition-outputs'
      : spec.source,
    path: '',
    parameters: parameters as string[],
  }
}

// Извлекает expression-body из arrow/function callback и компилирует его в IR.
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

// Снимает TS/parentheses wrappers с AST expression.
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
  if (t.isIdentifier(node)) {
    return node.name
  }
  if (t.isStringLiteral(node) || t.isNumericLiteral(node)) {
    return String(node.value)
  }
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
  if (t.isNullLiteral(node)) {
    return null
  }
  return node.value
}
