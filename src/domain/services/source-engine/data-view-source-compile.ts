import type {
  DataViewExpression,
  DataViewManualTransform,
  DataViewPathOperation,
  DataViewPipelineStep,
  DataViewSourceCompileResult,
  DataViewSourceDocument,
} from '@/domain/types/data-view-source.types'
import type { DataViewProgramPayload, ProgramDiagnostic } from '@/domain/types/program.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

/** Компилирует DataView source v1 в canonical document и executable artifact payload. */
export function compileDataViewSource(source: string): DataViewSourceCompileResult {
  const diagnostics: DiagnosticDraft[] = []

  try {
    const ast = parseTS(source, {
      sourceType: 'module',
      plugins: ['typescript'],
    })

    const defineCall = findDefineDataViewCall(ast)
    if (!defineCall) {
      diagnostics.push(createDiagnostic(
        'error',
        'data-view-source-define-missing',
        'DataView source должен содержать вызов defineDataView({...}).',
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
        'data-view-source-define-argument',
        'defineDataView принимает только объектный литерал.',
      ))
      return { ast, document: null, artifact: null, diagnostics }
    }

    const document = parseDocument(definition, source, diagnostics)
    const hasErrors = diagnostics.some(diagnostic => diagnostic.severity === 'error')

    return {
      ast,
      document: hasErrors ? null : document,
      artifact: hasErrors ? null : createDataViewArtifact(document),
      diagnostics,
    }
  }
  catch (error: any) {
    diagnostics.push(createDiagnostic(
      'error',
      'data-view-source-parse-error',
      `Не удалось распарсить DataView source: ${error?.message ?? error}`,
    ))

    return { ast: null, document: null, artifact: null, diagnostics }
  }
}

function findDefineDataViewCall(ast: t.File): t.CallExpression | null {
  for (const statement of ast.program.body) {
    if (!t.isExpressionStatement(statement))
      continue

    const expression = unwrapExpression(statement.expression)
    if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'defineDataView' }))
      return expression
  }

  return null
}

function parseDocument(
  definition: t.ObjectExpression,
  source: string,
  diagnostics: DiagnosticDraft[],
): DataViewSourceDocument {
  const declaredMode = readStringProperty(definition, 'mode')
  const transformNode = readObjectProperty(definition, 'transform')
  const stepsNode = readArrayProperty(definition, 'steps')
  const hasTransform = transformNode != null
  const hasSteps = stepsNode != null

  if (hasTransform && hasSteps) {
    diagnostics.push(createDiagnostic(
      'error',
      'data-view-source-mode-conflict',
      'DataView source не может одновременно содержать transform и steps.',
      'mode',
    ))
  }

  const mode = declaredMode === 'pipeline' || hasSteps ? 'pipeline' : 'manual'
  if (declaredMode && declaredMode !== mode) {
    diagnostics.push(createDiagnostic(
      'warning',
      'data-view-source-mode-inferred',
      `DataView mode "${declaredMode}" не совпадает с содержимым source, используется "${mode}".`,
      'mode',
    ))
  }

  if (mode === 'manual') {
    const transform = transformNode ? readManualTransform(transformNode, source, diagnostics) : null
    if (!transform) {
      diagnostics.push(createDiagnostic(
        'error',
        'data-view-source-transform-missing',
        'Manual DataView должен содержать transform(input, tools) { ... }.',
        'transform',
      ))
    }
    return { mode, transform: transform ?? undefined }
  }

  const steps = stepsNode ? readPipelineSteps(stepsNode, diagnostics) : []
  if (!steps.length) {
    diagnostics.push(createDiagnostic(
      'error',
      'data-view-source-steps-missing',
      'Pipeline DataView должен содержать непустой steps array.',
      'steps',
    ))
  }

  return { mode, steps }
}

function readManualTransform(
  node: t.ObjectMethod | t.ObjectProperty,
  source: string,
  diagnostics: DiagnosticDraft[],
): DataViewManualTransform | null {
  if (t.isObjectMethod(node)) {
    const params = node.params.map(param => t.isIdentifier(param) ? param.name : '').filter(Boolean)
    const body = node.body.start != null && node.body.end != null
      ? source.slice(node.body.start + 1, node.body.end - 1)
      : ''
    return { params, body }
  }

  diagnostics.push(createDiagnostic(
    'error',
    'data-view-source-transform-shape',
    'В v1 transform должен быть методом объекта: transform(input, tools) { ... }.',
    'transform',
  ))
  return null
}

function readPipelineSteps(node: t.ArrayExpression, diagnostics: DiagnosticDraft[]): DataViewPipelineStep[] {
  const steps: DataViewPipelineStep[] = []

  for (const element of node.elements) {
    if (!element || !t.isExpression(element))
      continue

    const step = readPipelineStep(unwrapExpression(element), diagnostics)
    if (step)
      steps.push(step)
  }

  return steps
}

function readPipelineStep(node: t.Expression, diagnostics: DiagnosticDraft[]): DataViewPipelineStep | null {
  const expression = unwrapExpression(node)

  const from = readFromStep(expression)
  if (from)
    return from

  const join = readJoinStep(expression, diagnostics)
  if (join)
    return join

  const map = readMapStep(expression, diagnostics)
  if (map)
    return map

  diagnostics.push(createDiagnostic(
    'warning',
    'data-view-source-step-unsupported',
    'Pipeline step пропущен: поддерживаются только from(...), join(...).by(...) и map({...}).',
  ))
  return null
}

function readFromStep(node: t.Expression) {
  if (t.isCallExpression(node) && isIdentifierCallee(node, 'from')) {
    return {
      type: 'from' as const,
      source: readStringArgument(node, 0) ?? '',
      as: 'item',
    }
  }

  if (!t.isCallExpression(node) || !t.isMemberExpression(node.callee))
    return null

  const member = node.callee
  if (!isIdentifierProperty(member, 'as'))
    return null

  const base = unwrapExpression(member.object as t.Expression)
  if (!t.isCallExpression(base) || !isIdentifierCallee(base, 'from'))
    return null

  return {
    type: 'from' as const,
    source: readStringArgument(base, 0) ?? '',
    as: readStringArgument(node, 0) ?? 'item',
  }
}

function readJoinStep(node: t.Expression, diagnostics: DiagnosticDraft[]) {
  if (!t.isCallExpression(node) || !t.isMemberExpression(node.callee))
    return null

  const member = node.callee
  if (!isIdentifierProperty(member, 'by'))
    return null

  const base = unwrapExpression(member.object as t.Expression)
  if (!t.isCallExpression(base) || !isIdentifierCallee(base, 'join'))
    return null

  const byArg = node.arguments[0]
  const by = byArg && t.isObjectExpression(byArg) ? byArg : null
  if (!by) {
    diagnostics.push(createDiagnostic('error', 'data-view-source-join-by', 'join(...).by(...) принимает объект.', 'steps'))
    return null
  }

  return {
    type: 'join' as const,
    source: readStringArgument(base, 0) ?? '',
    left: readStringProperty(by, 'left') ?? '',
    right: readStringProperty(by, 'right') ?? '',
    as: readStringProperty(by, 'as') ?? 'joined',
  }
}

function readMapStep(node: t.Expression, diagnostics: DiagnosticDraft[]) {
  if (!t.isCallExpression(node) || !isIdentifierCallee(node, 'map'))
    return null

  const fieldsArg = node.arguments[0]
  const fieldsNode = fieldsArg && t.isObjectExpression(fieldsArg) ? fieldsArg : null
  if (!fieldsNode) {
    diagnostics.push(createDiagnostic('error', 'data-view-source-map-fields', 'map(...) принимает объект полей.', 'steps'))
    return null
  }

  const spreads: Array<{ source: string }> = []
  const fields: Record<string, DataViewExpression> = {}
  for (const property of fieldsNode.properties) {
    if (t.isSpreadElement(property)) {
      const spread = readMapSpread(property.argument, diagnostics)
      if (spread)
        spreads.push(spread)
      continue
    }

    if (!t.isObjectProperty(property))
      continue
    const key = getPropertyName(property.key)
    if (!key || !t.isExpression(property.value))
      continue
    fields[key] = readExpression(unwrapExpression(property.value))
  }

  return { type: 'map' as const, spreads, fields }
}

function readMapSpread(node: t.Expression, diagnostics: DiagnosticDraft[]): { source: string } | null {
  const expression = unwrapExpression(node)
  if (t.isCallExpression(expression) && isIdentifierCallee(expression, 'spread')) {
    const source = readStringArgument(expression, 0)
    if (source)
      return { source }
  }

  diagnostics.push(createDiagnostic(
    'warning',
    'data-view-source-map-spread-unsupported',
    'Map spread пропущен: используйте ...spread("alias").',
    'steps',
  ))
  return null
}

function readExpression(node: t.Expression): DataViewExpression {
  const expression = unwrapExpression(node)
  if (t.isStringLiteral(expression) || t.isNumericLiteral(expression) || t.isBooleanLiteral(expression) || t.isNullLiteral(expression))
    return { type: 'literal', value: literalValue(expression) }

  const pathExpression = readPathExpression(expression)
  if (pathExpression)
    return pathExpression

  if (t.isCallExpression(expression) && isIdentifierCallee(expression, 'template'))
    return { type: 'template', template: readStringArgument(expression, 0) ?? '' }

  return { type: 'literal', value: null }
}

function readPathExpression(node: t.Expression): DataViewExpression | null {
  const operations: DataViewPathOperation[] = []
  let current = unwrapExpression(node)

  while (t.isCallExpression(current) && t.isMemberExpression(current.callee)) {
    const member = current.callee
    const opName = getPropertyName(member.property)
    if (opName === 'find') {
      const criteria = current.arguments[0]
      operations.unshift({
        type: 'find',
        criteria: criteria && t.isObjectExpression(criteria) ? readObjectLiteral(criteria) : {},
      })
    }
    else if (opName === 'pick') {
      operations.unshift({
        type: 'pick',
        path: readStringArgument(current, 0) ?? '',
      })
    }
    else if (opName === 'convert') {
      operations.unshift({
        type: 'convert',
        converter: readStringArgument(current, 0) ?? '',
        options: readObjectArgument(current, 1),
      })
    }
    else {
      return null
    }

    current = unwrapExpression(member.object as t.Expression)
  }

  if (t.isCallExpression(current) && isIdentifierCallee(current, 'path')) {
    return {
      type: 'path',
      path: readStringArgument(current, 0) ?? '',
      operations,
    }
  }

  return null
}

function createDataViewArtifact(document: DataViewSourceDocument): DataViewProgramPayload {
  return {
    type: 'data-view',
    mode: document.mode,
    sourceDocument: document,
    transform: document.transform ?? null,
    steps: document.steps ?? [],
  }
}

function readObjectProperty(node: t.ObjectExpression, name: string): t.ObjectMethod | t.ObjectProperty | null {
  for (const property of node.properties) {
    if ((t.isObjectMethod(property) || t.isObjectProperty(property)) && getPropertyName(property.key) === name)
      return property
  }
  return null
}

function readPropertyValue(node: t.ObjectExpression, name: string): t.Expression | null {
  const property = readObjectProperty(node, name)
  if (!property || !t.isObjectProperty(property) || !t.isExpression(property.value))
    return null
  return unwrapExpression(property.value)
}

function readArrayProperty(node: t.ObjectExpression, name: string): t.ArrayExpression | null {
  const value = readPropertyValue(node, name)
  return value && t.isArrayExpression(value) ? value : null
}

function readStringProperty(node: t.ObjectExpression, name: string): string | null {
  const value = readPropertyValue(node, name)
  return value && t.isStringLiteral(value) ? value.value : null
}

function readStringArgument(node: t.CallExpression, index: number): string | null {
  const arg = node.arguments[index]
  return arg && t.isStringLiteral(arg) ? arg.value : null
}

function readObjectArgument(node: t.CallExpression, index: number): Record<string, unknown> | undefined {
  const arg = node.arguments[index]
  return arg && t.isObjectExpression(arg) ? readObjectLiteral(arg) : undefined
}

function readObjectLiteral(node: t.ObjectExpression): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const property of node.properties) {
    if (!t.isObjectProperty(property))
      continue
    const key = getPropertyName(property.key)
    if (!key)
      continue
    const value = property.value
    out[key] = t.isExpression(value) ? readUnknownExpression(unwrapExpression(value)) : null
  }
  return out
}

function readUnknownExpression(node: t.Expression): unknown {
  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node) || t.isNullLiteral(node))
    return literalValue(node)
  if (t.isObjectExpression(node))
    return readObjectLiteral(node)
  if (t.isArrayExpression(node))
    return node.elements.map(element => element && t.isExpression(element) ? readUnknownExpression(unwrapExpression(element)) : null)
  return null
}

function literalValue(node: t.StringLiteral | t.NumericLiteral | t.BooleanLiteral | t.NullLiteral): unknown {
  return t.isNullLiteral(node) ? null : node.value
}

function unwrapExpression<T extends t.Expression>(node: T): t.Expression {
  let current: t.Expression = node
  while (t.isTSAsExpression(current) || t.isTSTypeAssertion(current) || t.isParenthesizedExpression(current))
    current = current.expression
  return current
}

function isIdentifierCallee(node: t.CallExpression, name: string): boolean {
  return t.isIdentifier(node.callee, { name })
}

function isIdentifierProperty(node: t.MemberExpression, name: string): boolean {
  return getPropertyName(node.property) === name
}

function getPropertyName(node: t.Node): string | null {
  if (t.isIdentifier(node))
    return node.name
  if (t.isStringLiteral(node))
    return node.value
  if (t.isNumericLiteral(node))
    return String(node.value)
  return null
}

function createDiagnostic(
  severity: ProgramDiagnostic['severity'],
  code: string,
  message: string,
  sourcePath?: string,
): DiagnosticDraft {
  return { severity, code, message, sourcePath }
}
