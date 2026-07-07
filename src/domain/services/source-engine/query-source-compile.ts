import type {
  QuerySourceCompileResult,
  QuerySourceDocument,
  QuerySourceField,
  QuerySourceFilterItem,
} from '@/domain/types/query-source.types'
import type { ProgramDiagnostic, QueryProgramPayload } from '@/domain/types/program.types'
import type { RQueryAuth } from '@/domain/types/query.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import { QueryType } from '@/domain/types/document.types'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

/** Компилирует query source v1 в canonical document и query artifact payload. */
export function compileQuerySource(source: string): QuerySourceCompileResult {
  const diagnostics: DiagnosticDraft[] = []

  try {
    const ast = parseTS(source, {
      sourceType: 'module',
      plugins: ['typescript'],
    })

    const defineCall = findDefineQueryCall(ast)
    if (!defineCall) {
      diagnostics.push(createDiagnostic(
        'error',
        'query-source-define-query-missing',
        'Query source должен содержать вызов defineQuery({...}).',
      ))
      return { ast, document: null, artifact: null, diagnostics }
    }

    const definitionArg = defineCall.arguments[0]
    const definition = definitionArg && t.isExpression(definitionArg)
      ? unwrapExpression(definitionArg)
      : null
    if (!t.isObjectExpression(definition)) {
      diagnostics.push(createDiagnostic(
        'error',
        'query-source-define-query-argument',
        'defineQuery принимает только объектный литерал.',
      ))
      return { ast, document: null, artifact: null, diagnostics }
    }

    const document = parseDocument(definition, diagnostics)
    const hasErrors = diagnostics.some(diagnostic => diagnostic.severity === 'error')

    return {
      ast,
      document: hasErrors ? null : document,
      artifact: hasErrors ? null : createQueryArtifact(document),
      diagnostics,
    }
  }
  catch (error: any) {
    diagnostics.push(createDiagnostic(
      'error',
      'query-source-parse-error',
      `Не удалось распарсить query source: ${error?.message ?? error}`,
    ))

    return {
      ast: null,
      document: null,
      artifact: null,
      diagnostics,
    }
  }
}

function findDefineQueryCall(ast: t.File): t.CallExpression | null {
  for (const statement of ast.program.body) {
    if (!t.isExpressionStatement(statement))
      continue

    const expression = unwrapExpression(statement.expression)
    if (!t.isCallExpression(expression))
      continue

    if (t.isIdentifier(expression.callee, { name: 'defineQuery' }))
      return expression
  }

  return null
}

function parseDocument(
  node: t.ObjectExpression,
  diagnostics: DiagnosticDraft[],
): QuerySourceDocument {
  const kind = readStringProperty(node, 'kind') ?? 'rest'
  if (kind !== 'rest') {
    diagnostics.push(createDiagnostic(
      'error',
      'query-source-kind-unsupported',
      `Query source kind "${kind}" не поддерживается в v1.`,
      'kind',
    ))
  }

  const requestNode = readObjectProperty(node, 'request')
  const paramsNode = readObjectProperty(node, 'params')
  const filtersNode = readObjectProperty(node, 'filters')
  const responseNode = readObjectProperty(node, 'response')
  const mockNode = readObjectProperty(node, 'mock')

  return {
    kind: 'rest',
    request: {
      endpoint: requestNode ? readStringLikeProperty(requestNode, 'endpoint', diagnostics) ?? '' : '',
      path: requestNode ? readStringLikeProperty(requestNode, 'path', diagnostics) ?? '' : '',
      method: requestNode ? readStringProperty(requestNode, 'method') ?? 'POST' : 'POST',
      headers: requestNode ? readStringRecordProperty(requestNode, 'headers', diagnostics) : {},
      auth: requestNode ? readAuthProperty(requestNode, diagnostics) : { mode: 'token' },
      timeoutMs: requestNode ? readNumberProperty(requestNode, 'timeoutMs') : undefined,
      formUrlencoded: requestNode ? readBooleanProperty(requestNode, 'formUrlencoded') || undefined : undefined,
    },
    params: paramsNode ? readFieldRecord(paramsNode, diagnostics, 'params') : {},
    filters: filtersNode ? readFilters(filtersNode, diagnostics) : { mode: 'merge' as const, items: [] },
    response: {
      subField: responseNode ? readStringProperty(responseNode, 'subField') ?? 'items' : 'items',
      return: responseNode ? readFieldOrNullProperty(responseNode, 'return', diagnostics, 'response.return') : null,
    },
    mock: {
      enabled: mockNode ? readBooleanProperty(mockNode, 'enabled') ?? false : false,
      data: mockNode ? readUnknownProperty(mockNode, 'data', diagnostics) ?? null : null,
    },
  }
}

function createQueryArtifact(document: QuerySourceDocument): QueryProgramPayload {
  return {
    type: QueryType.REST,
    method: document.request.method,
    endpoint: document.request.endpoint,
    query: document.request.path,
    headers: document.request.headers,
    auth: document.request.auth,
    timeoutMs: document.request.timeoutMs,
    sendAsFormUrlencoded: document.request.formUrlencoded,
    subField: document.response.subField,
    params: document.params,
    returnField: document.response.return,
    filters: document.filters.items.map(item => {
      if (item.mode === 'reference') {
        return {
          mode: 'reference',
          filterId: item.filterId,
          inlineJson: null,
        }
      }

      return {
        mode: 'inline',
        filterId: null,
        inlineJson: JSON.stringify(item.value),
      }
    }),
    filterMode: document.filters.mode,
    mockDataEnabled: document.mock.enabled,
    mockData: document.mock.data,
  }
}

function readFilters(
  node: t.ObjectExpression,
  diagnostics: DiagnosticDraft[],
) {
  const mode = readStringProperty(node, 'mode') ?? 'merge'
  const itemsNode = readPropertyValue(node, 'items')
  const items: QuerySourceFilterItem[] = []

  if (!itemsNode)
    return { mode: 'merge' as const, items }

  const value = unwrapExpression(itemsNode)
  if (!t.isArrayExpression(value)) {
    diagnostics.push(createDiagnostic(
      'error',
      'query-source-filters-items',
      'filters.items должен быть массивом.',
      'filters.items',
    ))
    return { mode: 'merge' as const, items }
  }

  value.elements.forEach((element, index) => {
    const item = element ? parseFilterItem(unwrapExpression(element as t.Expression), diagnostics, `filters.items.${index}`) : null
    if (item)
      items.push(item)
  })

  return {
    mode: mode === 'merge' ? mode : 'merge' as const,
    items,
  }
}

function parseFilterItem(
  node: t.Expression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): QuerySourceFilterItem | null {
  const call = unwrapExpression(node)
  if (!t.isCallExpression(call) || !t.isMemberExpression(call.callee)) {
    diagnostics.push(createDiagnostic(
      'error',
      'query-source-filter-call',
      'Фильтр должен быть filter.reference(...) или filter.inline(...).',
      sourcePath,
    ))
    return null
  }

  if (!t.isIdentifier(call.callee.object, { name: 'filter' }) || !t.isIdentifier(call.callee.property)) {
    diagnostics.push(createDiagnostic(
      'error',
      'query-source-filter-call',
      'Фильтр должен быть filter.reference(...) или filter.inline(...).',
      sourcePath,
    ))
    return null
  }

  const method = call.callee.property.name
  if (method === 'reference') {
    const filterId = expressionToUnknown(call.arguments[0], diagnostics, sourcePath)
    return typeof filterId === 'string'
      ? { mode: 'reference', filterId }
      : null
  }

  if (method === 'inline') {
    const value = expressionToUnknown(call.arguments[0], diagnostics, sourcePath)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { mode: 'inline', value: value as Record<string, unknown> }
      : { mode: 'inline', value: {} }
  }

  diagnostics.push(createDiagnostic(
    'error',
    'query-source-filter-method',
    `filter.${method} не поддерживается в query source v1.`,
    sourcePath,
  ))
  return null
}

function readFieldRecord(
  node: t.ObjectExpression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): Record<string, QuerySourceField> {
  const out: Record<string, QuerySourceField> = {}

  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed)
      continue

    const key = getPropertyName(property.key)
    if (!key)
      continue

    const field = parseFieldExpression(unwrapExpression(property.value as t.Expression), diagnostics, `${sourcePath}.${key}`)
    if (field)
      out[key] = field
  }

  return out
}

function readFieldOrNullProperty(
  node: t.ObjectExpression,
  key: string,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): QuerySourceField | null {
  const value = readPropertyValue(node, key)
  if (!value)
    return null

  const expression = unwrapExpression(value)
  if (t.isNullLiteral(expression))
    return null

  return parseFieldExpression(expression, diagnostics, sourcePath, { emptyFieldAsNull: true })
}

function parseFieldExpression(
  node: t.Expression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
  options: { emptyFieldAsNull?: boolean } = {},
): QuerySourceField | null {
  if (t.isObjectExpression(node)) {
    const type = readStringProperty(node, 'type')
    if (!type?.trim())
      return null

    return {
      type,
      isArray: readBooleanProperty(node, 'isArray') || undefined,
      optional: readBooleanProperty(node, 'optional') || undefined,
      params: readObjectProperty(node, 'params')
        ? readFieldRecord(readObjectProperty(node, 'params')!, diagnostics, `${sourcePath}.params`)
        : undefined,
    }
  }

  let current: t.Expression = node
  const modifiers: Array<{ name: string, argument?: t.CallExpression['arguments'][number] }> = []

  while (t.isCallExpression(current) && t.isMemberExpression(current.callee)) {
    const property: t.MemberExpression['property'] = current.callee.property
    if (t.isIdentifier(property))
      modifiers.push({ name: property.name, argument: current.arguments[0] })

    if (!t.isExpression(current.callee.object))
      return unsupportedField(diagnostics, sourcePath, node)

    const next: t.Expression = unwrapExpression(current.callee.object)
    current = next
  }

  if (!t.isCallExpression(current))
    return unsupportedField(diagnostics, sourcePath, node)

  let type: string | null = null
  if (t.isIdentifier(current.callee, { name: 'field' })) {
    const rawType = expressionToUnknown(current.arguments[0], diagnostics, sourcePath)
    type = typeof rawType === 'string' ? rawType.trim() : null
  }
  else if (
    t.isMemberExpression(current.callee)
    && t.isIdentifier(current.callee.object, { name: 'field' })
    && t.isIdentifier(current.callee.property)
  ) {
    type = normalizeFieldType(current.callee.property.name)
  }

  if (!type) {
    if (options.emptyFieldAsNull)
      return null
    return unsupportedField(diagnostics, sourcePath, node)
  }

  const field: QuerySourceField = { type }
  for (const modifier of modifiers) {
    if (modifier.name === 'array') {
      field.isArray = true
      continue
    }
    if (modifier.name === 'optional') {
      field.optional = true
      continue
    }
    if (modifier.name === 'params' && modifier.argument) {
      const argument = unwrapExpression(modifier.argument as t.Expression)
      if (t.isObjectExpression(argument))
        field.params = readFieldRecord(argument, diagnostics, `${sourcePath}.params`)
    }
  }

  return field
}

function unsupportedField(
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
  node: t.Expression,
): null {
  diagnostics.push(createDiagnostic(
    'error',
    'query-source-field-unsupported',
    'Поле должно быть описано через field(...) или field.string().',
    sourcePath,
    node,
  ))
  return null
}

function normalizeFieldType(type: string): string {
  const aliases: Record<string, string> = {
    string: 'String',
    number: 'Number',
    boolean: 'Boolean',
    date: 'Date',
    datetime: 'DateTime',
    object: 'Object',
    unknown: 'Unknown',
  }

  return aliases[type] ?? type
}

function readStringLikeProperty(
  node: t.ObjectExpression,
  key: string,
  diagnostics: DiagnosticDraft[],
): string | null {
  const value = readPropertyValue(node, key)
  if (!value)
    return null

  const parsed = expressionToUnknown(value, diagnostics, key)
  return typeof parsed === 'string' ? parsed : null
}

function readStringProperty(node: t.ObjectExpression, key: string): string | null {
  const value = readPropertyValue(node, key)
  const expression = value ? unwrapExpression(value) : null
  return expression && t.isStringLiteral(expression) ? expression.value : null
}

function readNumberProperty(node: t.ObjectExpression, key: string): number | undefined {
  const value = readPropertyValue(node, key)
  const expression = value ? unwrapExpression(value) : null
  return expression && t.isNumericLiteral(expression) ? expression.value : undefined
}

function readBooleanProperty(node: t.ObjectExpression, key: string): boolean | undefined {
  const value = readPropertyValue(node, key)
  const expression = value ? unwrapExpression(value) : null
  if (expression && t.isBooleanLiteral(expression))
    return expression.value
  return undefined
}

function readStringRecordProperty(
  node: t.ObjectExpression,
  key: string,
  diagnostics: DiagnosticDraft[],
): Record<string, string> {
  const raw = readUnknownProperty(node, key, diagnostics)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return {}

  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw))
    out[name] = String(value)

  return out
}

function readAuthProperty(
  node: t.ObjectExpression,
  diagnostics: DiagnosticDraft[],
): RQueryAuth {
  const raw = readUnknownProperty(node, 'auth', diagnostics)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { mode: 'token' }

  const auth = raw as Partial<RQueryAuth>
  return auth.mode === 'none'
    ? { ...auth, mode: 'none' }
    : { ...auth, mode: 'token' }
}

function readUnknownProperty(
  node: t.ObjectExpression,
  key: string,
  diagnostics: DiagnosticDraft[],
): unknown {
  const value = readPropertyValue(node, key)
  return value ? expressionToUnknown(value, diagnostics, key) : undefined
}

function readObjectProperty(node: t.ObjectExpression, key: string): t.ObjectExpression | null {
  const value = readPropertyValue(node, key)
  const expression = value ? unwrapExpression(value) : null
  return expression && t.isObjectExpression(expression) ? expression : null
}

function readPropertyValue(node: t.ObjectExpression, key: string): t.Expression | null {
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed)
      continue

    if (getPropertyName(property.key) === key)
      return unwrapExpression(property.value as t.Expression)
  }

  return null
}

function expressionToUnknown(
  node: t.Node | null | undefined,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): unknown {
  if (!node)
    return undefined

  const expression = unwrapExpression(node as t.Expression)

  if (t.isStringLiteral(expression))
    return expression.value
  if (t.isNumericLiteral(expression))
    return expression.value
  if (t.isBooleanLiteral(expression))
    return expression.value
  if (t.isNullLiteral(expression))
    return null
  if (t.isArrayExpression(expression))
    return expression.elements.map(item => expressionToUnknown(item as t.Expression, diagnostics, sourcePath))
  if (t.isObjectExpression(expression))
    return objectExpressionToRecord(expression, diagnostics, sourcePath)
  if (isVarCall(expression)) {
    const name = expressionToUnknown(expression.arguments[0], diagnostics, sourcePath)
    return typeof name === 'string' ? `{${name}}` : ''
  }

  diagnostics.push(createDiagnostic(
    'error',
    'query-source-expression-unsupported',
    'В query source v1 поддерживаются только литералы и разрешенные macros.',
    sourcePath,
  ))
  return undefined
}

function objectExpressionToRecord(
  node: t.ObjectExpression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed) {
      diagnostics.push(createDiagnostic(
        'error',
        'query-source-object-property',
        'В query source v1 object spread и computed keys не поддерживаются.',
        sourcePath,
      ))
      continue
    }

    const key = getPropertyName(property.key)
    if (!key)
      continue

    out[key] = expressionToUnknown(property.value as t.Expression, diagnostics, `${sourcePath}.${key}`)
  }

  return out
}

function isVarCall(node: t.Expression): node is t.CallExpression {
  return t.isCallExpression(node)
    && (
      t.isIdentifier(node.callee, { name: 'env' })
      || t.isIdentifier(node.callee, { name: 'endgeVar' })
    )
}

function unwrapExpression<T extends t.Expression>(node: T): t.Expression {
  let current: t.Expression = node
  while (
    t.isTSAsExpression(current)
    || t.isTSTypeAssertion(current)
    || t.isTSNonNullExpression(current)
    || t.isParenthesizedExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function getPropertyName(key: t.ObjectProperty['key']): string | null {
  if (t.isIdentifier(key))
    return key.name
  if (t.isStringLiteral(key))
    return key.value
  if (t.isNumericLiteral(key))
    return String(key.value)
  return null
}

function createDiagnostic(
  severity: DiagnosticDraft['severity'],
  code: string,
  message: string,
  sourcePath?: string,
  node?: t.Node,
): DiagnosticDraft {
  const start = typeof node?.start === 'number' ? node.start : undefined
  const end = typeof node?.end === 'number' ? node.end : undefined

  return {
    severity,
    code,
    message,
    sourcePath,
    start,
    end,
  }
}
