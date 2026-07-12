import type {
  QueryOutputSource,
  QuerySourceCompileResult,
  QuerySourceDocument,
  QuerySourceOutput,
} from '@/domain/types/query-source.types'
import type { ProgramDiagnostic, QueryProgramPayload } from '@/domain/types/program.types'
import type { RQueryAuth } from '@/domain/types/query.types'
import type { DataViewRef } from '@/domain/types/data-view-source.types'
import type { QueryProgramProp } from '@/domain/types/source-expression.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import { QueryType } from '@/domain/types/document.types'
import { compileSourceCallback } from '@/domain/services/source-engine/source-expression-compile'
import { compileSourceField } from '@/domain/services/source-engine/source-field-compile'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

/** Компилирует source-only Query v2 в canonical document и query artifact payload. */
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

    const document = parseDocument(definition, source, diagnostics)
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
  source: string,
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
  const propsNode = readPropertyValue(node, 'props')
  const responseNode = readObjectProperty(node, 'response')
  const outputsNode = readObjectProperty(node, 'outputs')
  const mockNode = readObjectProperty(node, 'mock')

  for (const key of ['params', 'filters']) {
    const legacy = readPropertyValue(node, key)
    if (legacy) {
      diagnostics.push(createDiagnostic(
        'error',
        'query-source-legacy-property',
        `Query source v2 не поддерживает legacy поле "${key}". Используйте props/request.body/outputs.`,
        key,
        legacy,
      ))
    }
  }

  if (responseNode) {
    diagnostics.push(createDiagnostic(
      'error',
      'query-source-response-unsupported',
      'Блок response удален из query source v2. Используйте outputs: { raw: output().from(response(...)) }.',
      'response',
    ))
  }

  const props = propsNode ? readProps(propsNode, source, diagnostics) : []
  const requestBodyNode = requestNode ? readPropertyValue(requestNode, 'body') : null
  const requestBody = requestBodyNode ? readRequestBody(requestBodyNode, diagnostics) : null
  const propKeys = new Set(props.map(prop => prop.key))
  if (propsNode && requestNode && (propsNode.start ?? 0) > (requestNode.start ?? 0)) {
    diagnostics.push(createDiagnostic(
      'error',
      'query-source-props-order',
      'props должен быть объявлен до request.',
      'props',
      propsNode,
    ))
  }
  validateBodyPropReferences(requestBody, propKeys, diagnostics)

  return {
    kind: 'rest',
    request: {
      endpoint: requestNode ? readStringLikeProperty(requestNode, 'endpoint', diagnostics) ?? '' : '',
      path: requestNode ? readStringLikeProperty(requestNode, 'path', diagnostics) ?? '' : '',
      method: requestNode ? readStringProperty(requestNode, 'method') ?? 'POST' : 'POST',
      headers: requestNode ? readStringRecordProperty(requestNode, 'headers', diagnostics) : {},
      auth: requestNode ? readAuthProperty(requestNode, diagnostics) : { mode: 'inherit' },
      timeoutMs: requestNode ? readNumberProperty(requestNode, 'timeoutMs') : undefined,
      formUrlencoded: requestNode ? readBooleanProperty(requestNode, 'formUrlencoded') || undefined : undefined,
      body: requestBody,
    },
    props,
    outputs: outputsNode ? readOutputs(outputsNode, source, diagnostics) : [],
    mock: {
      enabled: mockNode ? readBooleanProperty(mockNode, 'enabled') ?? false : false,
      data: mockNode ? readUnknownProperty(mockNode, 'data', diagnostics) ?? null : null,
    },
  }
}

function createQueryArtifact(document: QuerySourceDocument): QueryProgramPayload {
  return {
    type: QueryType.REST,
    sourceVersion: 2,
    method: document.request.method,
    endpoint: document.request.endpoint,
    query: document.request.path,
    headers: document.request.headers,
    auth: document.request.auth,
    timeoutMs: document.request.timeoutMs,
    sendAsFormUrlencoded: document.request.formUrlencoded,
    props: document.props,
    requestBody: document.request.body ?? null,
    mockDataEnabled: document.mock.enabled,
    mockData: document.mock.data,
    outputs: document.outputs.map(output => ({
      key: output.key,
      source: output.source,
      dataViews: output.dataViews,
      materialization: output.source.type === 'response' && output.dataViews.length === 0
        ? { kind: 'source' as const }
        : { kind: 'derived' as const, strategy: { kind: 'full' as const } },
    })),
  }
}

function readRequestBody(
  node: t.Expression,
  diagnostics: DiagnosticDraft[],
) {
  const expression = unwrapExpression(node)
  if (!t.isCallExpression(expression) || !t.isIdentifier(expression.callee, { name: 'body' })) {
    diagnostics.push(createDiagnostic('error', 'query-source-body-shape', 'request.body должен быть body(callback).', 'request.body', expression))
    return null
  }
  return compileSourceCallback(expression.arguments[0], diagnostics, 'request.body')
}

function readProps(
  node: t.Expression,
  source: string,
  diagnostics: DiagnosticDraft[],
): QueryProgramProp[] {
  const expression = unwrapExpression(node)
  if (!t.isCallExpression(expression) || !t.isIdentifier(expression.callee, { name: 'defineProps' })) {
    diagnostics.push(createDiagnostic('error', 'query-source-props-shape', 'props должен быть defineProps({...}).', 'props', expression))
    return []
  }
  const definition = expression.arguments[0]
  if (!definition || !t.isObjectExpression(definition)) {
    diagnostics.push(createDiagnostic('error', 'query-source-props-object', 'defineProps принимает object literal.', 'props', expression))
    return []
  }

  const props: QueryProgramProp[] = []
  const declared = new Set<string>()
  for (const property of definition.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      diagnostics.push(createDiagnostic('error', 'query-source-prop-property', 'defineProps допускает обычные properties.', 'props', property))
      continue
    }
    const key = getPropertyName(property.key)
    if (!key)
      continue
    if (declared.has(key)) {
      diagnostics.push(createDiagnostic('error', 'query-source-prop-duplicate', `Prop "${key}" объявлен повторно.`, `props.${key}`, property))
      continue
    }
    declared.add(key)
    const parsed = compileSourceField(key, property.value, source, diagnostics, `props.${key}`)
    if (parsed)
      props.push({ ...parsed.field, defaultSource: parsed.defaultSource })
  }
  return props
}

function readOutputs(
  node: t.ObjectExpression,
  source: string,
  diagnostics: DiagnosticDraft[],
): QuerySourceOutput[] {
  const outputs: QuerySourceOutput[] = []
  const declared = new Set<string>()

  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed) {
      diagnostics.push(createDiagnostic(
        'error',
        'query-source-output-property',
        'outputs поддерживает только обычные object properties.',
        'outputs',
      ))
      continue
    }

    const key = getPropertyName(property.key)
    if (!key || !t.isExpression(property.value))
      continue

    if (declared.has(key)) {
      diagnostics.push(createDiagnostic(
        'error',
        'query-source-output-duplicate',
        `Output "${key}" объявлен повторно.`,
        `outputs.${key}`,
      ))
      continue
    }

    const output = readOutput(key, unwrapExpression(property.value), source, diagnostics)
    if (output) {
      if (output.source.type === 'output' && !declared.has(output.source.key)) {
        diagnostics.push(createDiagnostic(
          'error',
          'query-source-output-forward-reference',
          `Output "${key}" ссылается на "${output.source.key}", который не объявлен выше.`,
          `outputs.${key}.from`,
        ))
      }

      outputs.push(output)
      declared.add(key)
    }
  }

  return outputs
}

function validateBodyPropReferences(
  expression: import('@/domain/types/source-expression.types').SourceExpressionIR | null,
  propKeys: Set<string>,
  diagnostics: DiagnosticDraft[],
): void {
  if (!expression)
    return
  const visit = (node: import('@/domain/types/source-expression.types').SourceExpressionIR) => {
    if (node.type === 'read') {
      if (node.source !== 'prop') {
        diagnostics.push(createDiagnostic('error', 'query-source-body-read', `request.body не поддерживает read source "${node.source}".`, 'request.body'))
      }
      else if (!propKeys.has(node.path)) {
        diagnostics.push(createDiagnostic('error', 'query-source-body-prop-missing', `Prop "${node.path}" не объявлен в defineProps.`, 'request.body'))
      }
    }
    else if (node.type === 'operation') {
      node.arguments.forEach(visit)
    }
    else if (node.type === 'array') {
      node.items.forEach(visit)
    }
    else if (node.type === 'object') {
      Object.values(node.properties).forEach(visit)
    }
  }
  visit(expression)
}

function readOutput(
  key: string,
  node: t.Expression,
  source: string,
  diagnostics: DiagnosticDraft[],
): QuerySourceOutput | null {
  const calls = collectMemberCallChain(node)
  if (!calls)
    return unsupportedOutput(key, diagnostics, node)

  let outputSource: QueryOutputSource | null = null
  const dataViews: DataViewRef[] = []

  for (const call of calls.modifiers) {
    if (call.name === 'from') {
      outputSource = readOutputSource(call.arguments[0], diagnostics, `outputs.${key}.from`)
      continue
    }

    if (call.name === 'dataView') {
      const dataViewRef = readDataViewRef(call.arguments[0], source, diagnostics, `outputs.${key}.dataView`)
      if (dataViewRef)
        dataViews.push(dataViewRef)
      continue
    }

    diagnostics.push(createDiagnostic(
      'error',
      'query-source-output-method-unsupported',
      `output().${call.name}(...) не поддерживается в query source v2.`,
      `outputs.${key}`,
    ))
  }

  if (!outputSource) {
    diagnostics.push(createDiagnostic(
      'error',
      'query-source-output-from-missing',
      `Output "${key}" должен содержать .from(...).`,
      `outputs.${key}`,
      node,
    ))
    return null
  }

  return { key, source: outputSource, dataViews }
}

function unsupportedOutput(
  key: string,
  diagnostics: DiagnosticDraft[],
  node: t.Expression,
): null {
  diagnostics.push(createDiagnostic(
    'error',
    'query-source-output-shape',
    `Output "${key}" должен быть описан через output().from(...).`,
    `outputs.${key}`,
    node,
  ))
  return null
}

function collectMemberCallChain(
  node: t.Expression,
): { modifiers: Array<{ name: string, arguments: t.CallExpression['arguments'] }> } | null {
  let current = unwrapExpression(node)
  const modifiers: Array<{ name: string, arguments: t.CallExpression['arguments'] }> = []

  while (t.isCallExpression(current) && t.isMemberExpression(current.callee)) {
    const name = getPropertyName(current.callee.property)
    if (!name || !t.isExpression(current.callee.object))
      return null

    modifiers.unshift({ name, arguments: current.arguments })
    current = unwrapExpression(current.callee.object)
  }

  if (!t.isCallExpression(current) || !t.isIdentifier(current.callee, { name: 'output' }))
    return null

  return { modifiers }
}

function readOutputSource(
  node: t.CallExpression['arguments'][number] | undefined,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): QueryOutputSource | null {
  if (!node || !t.isExpression(node)) {
    diagnostics.push(createDiagnostic('error', 'query-source-output-source-missing', '.from(...) должен получить источник.', sourcePath))
    return null
  }

  const expression = unwrapExpression(node)
  if (t.isStringLiteral(expression))
    return { type: 'output', key: expression.value }

  if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'response' })) {
    const path = expression.arguments[0]
    if (!path)
      return { type: 'response', path: null }
    if (t.isStringLiteral(path))
      return { type: 'response', path: path.value }
  }

  diagnostics.push(createDiagnostic(
    'error',
    'query-source-output-source-unsupported',
    '.from(...) поддерживает только response(path?) или ключ предыдущего output.',
    sourcePath,
    expression,
  ))
  return null
}

function readDataViewRef(
  node: t.CallExpression['arguments'][number] | undefined,
  source: string,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): DataViewRef | null {
  if (!node || !t.isExpression(node)) {
    diagnostics.push(createDiagnostic('error', 'query-source-output-dataview-missing', '.dataView(...) должен получить DataView.', sourcePath))
    return null
  }

  const expression = unwrapExpression(node)
  if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'dataView' })) {
    const identity = expression.arguments[0]
    if (t.isStringLiteral(identity))
      return { kind: 'external', identity: identity.value }
  }

  if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'defineDataView' })) {
    if (isManualDataViewDefinition(expression.arguments[0])) {
      diagnostics.push(createDiagnostic(
        'error',
        'query-source-local-dataview-manual-unsupported',
        'Локальные DataView внутри query в v1 поддерживают только mode: pipeline.',
        sourcePath,
        expression,
      ))
    }

    if (typeof expression.start === 'number' && typeof expression.end === 'number')
      return { kind: 'inline', source: source.slice(expression.start, expression.end) }
  }

  diagnostics.push(createDiagnostic(
    'error',
    'query-source-output-dataview-unsupported',
    '.dataView(...) поддерживает dataView("identity") или defineDataView({...}).',
    sourcePath,
    expression,
  ))
  return null
}

function isManualDataViewDefinition(node: t.Node | null | undefined): boolean {
  if (!node || !t.isObjectExpression(unwrapExpression(node as t.Expression)))
    return false

  const definition = unwrapExpression(node as t.Expression) as t.ObjectExpression
  const mode = readStringProperty(definition, 'mode')
  const hasTransform = definition.properties.some(property =>
    (t.isObjectMethod(property) || t.isObjectProperty(property)) && getPropertyName(property.key) === 'transform',
  )
  const hasSteps = Boolean(readPropertyValue(definition, 'steps'))
  return mode === 'manual' || (hasTransform && !hasSteps)
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
    return { mode: 'inherit' }

  const auth = raw as Partial<RQueryAuth>
  const profile = auth.profile ?? auth.authProfileIdentity
  if (auth.mode === 'none')
    return { ...auth, mode: 'none' }
  if (auth.mode === 'manual')
    return { ...auth, mode: 'manual' }
  if (auth.mode === 'profile')
    return { ...auth, mode: 'profile', profile, authProfileIdentity: profile }
  return { ...auth, mode: 'inherit' }
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

function getPropertyName(key: t.Node): string | null {
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
