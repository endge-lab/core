import type {
  DataViewExpression,
  DataViewIncrementalRequest,
  DataViewMaterializationStrategy,
  DataViewRef,
  DataViewManualTransform,
  DataViewPathOperation,
  DataViewPipelineStep,
  DataViewSourceCompileResult,
  DataViewSourceDocument,
  DataViewSourceMode,
} from '@/domain/types/source/data-view-source.types'
import type { SourceExpressionIR } from '@/domain/types/source/source-expression.types'
import type { DataViewProgramPayload, ProgramDiagnostic } from '@/domain/types/program/program.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'
import { compileProgramMetadataProperty } from '@/model/services/source-engine/compilers/source-metadata-compile'
import { compileSourceExpression } from '@/model/services/source-engine/compilers/source-expression-compile'
import { readSourceModelIdentity, readSourceModelReference } from '@/model/services/source-engine/compilers/source-model-reference-compile'

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
      return { ast, document: null, artifact: null, metadata: {}, diagnostics }
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
      return { ast, document: null, artifact: null, metadata: {}, diagnostics }
    }

    const metadata = compileProgramMetadataProperty(definition, diagnostics)
    const document = parseDocument(definition, source, diagnostics)
    const hasErrors = diagnostics.some(diagnostic => diagnostic.severity === 'error')

    return {
      ast,
      document: hasErrors ? null : document,
      artifact: hasErrors ? null : createDataViewArtifact(document),
      metadata,
      diagnostics,
    }
  }
  catch (error: any) {
    diagnostics.push(createDiagnostic(
      'error',
      'data-view-source-parse-error',
      `Не удалось распарсить DataView source: ${error?.message ?? error}`,
    ))

    return { ast: null, document: null, artifact: null, metadata: {}, diagnostics }
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
  const incremental = readIncrementalRequest(definition, diagnostics)
  const transformNode = readObjectProperty(definition, 'transform')
  const stepsNode = readArrayProperty(definition, 'steps')
  const outputValue = readPropertyValue(definition, 'output')
  const outputNode = outputValue && t.isObjectExpression(outputValue) ? outputValue : null
  const hasTransform = transformNode != null
  const hasSteps = stepsNode != null
  const hasOutput = outputValue != null

  if ([hasTransform, hasSteps, hasOutput].filter(Boolean).length > 1) {
    diagnostics.push(createDiagnostic(
      'error',
      'data-view-source-mode-conflict',
      'DataView source должен содержать только один из contracts: transform, steps или output.',
      'mode',
    ))
  }

  const mode: DataViewSourceMode = hasOutput
    ? outputNode ? 'projection' : 'expression'
    : declaredMode === 'projection'
      ? 'projection'
      : declaredMode === 'expression'
        ? 'expression'
    : declaredMode === 'pipeline' || hasSteps
      ? 'pipeline'
      : 'manual'
  if (declaredMode && declaredMode !== mode) {
    diagnostics.push(createDiagnostic(
      'warning',
      'data-view-source-mode-inferred',
      `DataView mode "${declaredMode}" не совпадает с содержимым source, используется "${mode}".`,
      'mode',
    ))
  }

  if (mode === 'projection') {
    const output = outputNode ? readProjectionOutput(outputNode, diagnostics) : {}
    if (!Object.keys(output).length) {
      diagnostics.push(createDiagnostic(
        'error',
        'data-view-source-output-missing',
        'Projection DataView должен содержать непустой output object.',
        'output',
      ))
    }
    if (incremental.mode === 'collection-by-key') {
      diagnostics.push(createDiagnostic(
        'error',
        'data-view-source-incremental-projection',
        'Projection DataView не может использовать collectionByKey; выберите full().',
        'incremental',
      ))
    }
    return { mode, incremental, output }
  }

  if (mode === 'expression') {
    const expression = outputValue && t.isExpression(outputValue)
      ? compileSourceExpression(outputValue, diagnostics, 'output')
      : null
    if (!expression) {
      diagnostics.push(createDiagnostic(
        'error',
        'data-view-source-expression-missing',
        'Expression DataView должен содержать output expression.',
        'output',
      ))
    }
    if (incremental.mode === 'collection-by-key') {
      diagnostics.push(createDiagnostic(
        'error',
        'data-view-source-incremental-expression',
        'Expression DataView не может использовать collectionByKey; выберите full().',
        'incremental',
      ))
    }
    return { mode, incremental, expression: expression ?? undefined }
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
    if (incremental.mode === 'collection-by-key') {
      diagnostics.push(createDiagnostic(
        'error',
        'data-view-source-incremental-manual',
        'Manual DataView не может использовать collectionByKey; выберите full().',
        'incremental',
      ))
    }
    return { mode, incremental, transform: transform ?? undefined }
  }

  const steps = stepsNode ? readPipelineSteps(stepsNode, source, diagnostics) : []
  if (!steps.length) {
    diagnostics.push(createDiagnostic(
      'error',
      'data-view-source-steps-missing',
      'Pipeline DataView должен содержать непустой steps array.',
      'steps',
    ))
  }

  if (incremental.mode === 'collection-by-key' && !isRowLocalPipeline(steps, incremental.key)) {
    diagnostics.push(createDiagnostic(
      'error',
      'data-view-source-incremental-not-row-local',
      `DataView не доказывает row-local семантику для collectionByKey("${incremental.key}").`,
      'incremental',
    ))
  }

  return { mode, incremental, steps }
}

function readProjectionOutput(
  node: t.ObjectExpression,
  diagnostics: DiagnosticDraft[],
): Record<string, SourceExpressionIR> {
  const output: Record<string, SourceExpressionIR> = {}
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      diagnostics.push(createDiagnostic(
        'error',
        'data-view-source-output-property',
        'DataView output допускает только обычные expression properties.',
        'output',
      ))
      continue
    }
    const key = getPropertyName(property.key)
    if (!key)
      continue
    const expression = compileSourceExpression(
      unwrapExpression(property.value),
      diagnostics,
      `output.${key}`,
    )
    if (expression)
      output[key] = expression
  }
  return output
}

function readIncrementalRequest(
  definition: t.ObjectExpression,
  diagnostics: DiagnosticDraft[],
): DataViewIncrementalRequest {
  const node = readPropertyValue(definition, 'incremental')
  if (!node)
    return { mode: 'auto' }
  const expression = unwrapExpression(node)
  if (!t.isCallExpression(expression) || !t.isIdentifier(expression.callee)) {
    diagnostics.push(createDiagnostic('error', 'data-view-source-incremental-shape', 'incremental должен быть auto(), full() или collectionByKey(key).', 'incremental'))
    return { mode: 'auto' }
  }
  if (expression.callee.name === 'auto' && expression.arguments.length === 0)
    return { mode: 'auto' }
  if (expression.callee.name === 'full' && expression.arguments.length === 0)
    return { mode: 'full' }
  if (expression.callee.name === 'collectionByKey') {
    const key = expression.arguments[0]
    if (t.isStringLiteral(key) && key.value.trim())
      return { mode: 'collection-by-key', key: key.value.trim() }
    diagnostics.push(createDiagnostic('error', 'data-view-source-incremental-key', 'collectionByKey требует непустой строковый key.', 'incremental'))
    return { mode: 'auto' }
  }
  diagnostics.push(createDiagnostic('error', 'data-view-source-incremental-unsupported', 'incremental поддерживает только auto(), full() и collectionByKey(key).', 'incremental'))
  return { mode: 'auto' }
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

function readPipelineSteps(node: t.ArrayExpression, source: string, diagnostics: DiagnosticDraft[]): DataViewPipelineStep[] {
  const steps: DataViewPipelineStep[] = []

  for (const element of node.elements) {
    if (!element || !t.isExpression(element))
      continue

    const step = readPipelineStep(unwrapExpression(element), source, diagnostics)
    if (step)
      steps.push(step)
  }

  return steps
}

function readPipelineStep(node: t.Expression, source: string, diagnostics: DiagnosticDraft[]): DataViewPipelineStep | null {
  const expression = unwrapExpression(node)

  const from = readFromStep(expression, source, diagnostics)
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

function readFromStep(node: t.Expression, source: string, diagnostics: DiagnosticDraft[]) {
  const chain = collectFromChain(node)
  if (!chain)
    return null

  let as = 'item'
  const dataViews: DataViewRef[] = []

  for (const call of chain.modifiers) {
    if (call.name === 'as') {
      as = readStringArgumentFromArgs(call.arguments, 0) ?? 'item'
      continue
    }

    if (call.name === 'dataView') {
      const dataViewRef = readDataViewRef(call.arguments[0], source, diagnostics)
      if (dataViewRef)
        dataViews.push(dataViewRef)
      continue
    }

    diagnostics.push(createDiagnostic(
      'warning',
      'data-view-source-from-method-unsupported',
      `from(...).${call.name}(...) не поддерживается в DataView pipeline v1.`,
      'steps',
    ))
  }

  return {
    type: 'from' as const,
    source: readStringArgument(chain.base, 0) ?? '',
    as,
    dataViews: dataViews.length ? dataViews : undefined,
  }
}

function collectFromChain(
  node: t.Expression,
): { base: t.CallExpression, modifiers: Array<{ name: string, arguments: t.CallExpression['arguments'] }> } | null {
  let current = unwrapExpression(node)
  const modifiers: Array<{ name: string, arguments: t.CallExpression['arguments'] }> = []

  while (t.isCallExpression(current) && t.isMemberExpression(current.callee)) {
    const name = getPropertyName(current.callee.property)
    if (!name || !t.isExpression(current.callee.object))
      return null

    modifiers.unshift({ name, arguments: current.arguments })
    current = unwrapExpression(current.callee.object)
  }

  if (!t.isCallExpression(current) || !isIdentifierCallee(current, 'from'))
    return null

  return { base: current, modifiers }
}

function readDataViewRef(
  node: t.CallExpression['arguments'][number] | undefined,
  source: string,
  diagnostics: DiagnosticDraft[],
): DataViewRef | null {
  if (!node || !t.isExpression(node)) {
    diagnostics.push(createDiagnostic('error', 'data-view-source-dataview-missing', 'from(...).dataView(...) должен получить DataView.', 'steps'))
    return null
  }

  const reference = readSourceModelReference(node, source, {
    referenceCall: 'dataView',
    defineCall: 'defineDataView',
  })
  if (reference?.kind === 'external')
    return reference

  if (reference?.kind === 'inline') {
    if (isManualDataViewDefinition(reference.definition.arguments[0])) {
      diagnostics.push(createDiagnostic(
        'error',
        'data-view-source-local-dataview-manual-unsupported',
        'Локальные DataView внутри DataView в v1 поддерживают только mode: pipeline.',
        'steps',
      ))
    }

    return { kind: 'inline', source: reference.source }
  }

  diagnostics.push(createDiagnostic(
    'error',
    'data-view-source-dataview-unsupported',
    'from(...).dataView(...) поддерживает "identity", dataView("identity") или defineDataView({...}).',
    'steps',
  ))
  return null
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
    fields[key] = readExpression(unwrapExpression(property.value), diagnostics, `steps.map.${key}`)
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

function readExpression(node: t.Expression, diagnostics: DiagnosticDraft[], sourcePath: string): DataViewExpression {
  const expression = unwrapExpression(node)
  if (t.isStringLiteral(expression) || t.isNumericLiteral(expression) || t.isBooleanLiteral(expression) || t.isNullLiteral(expression))
    return { type: 'literal', value: literalValue(expression) }

  const pathExpression = readPathExpression(expression)
  if (pathExpression)
    return pathExpression

  if (t.isCallExpression(expression) && isIdentifierCallee(expression, 'template'))
    return { type: 'template', template: readStringArgument(expression, 0) ?? '' }

  const compiled = compileSourceExpression(expression, diagnostics, sourcePath)
  if (compiled)
    return compiled

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
        converter: readSourceModelIdentity(current.arguments[0], 'converter') ?? '',
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
    materializationStrategy: resolveMaterializationStrategy(document),
    sourceDocument: document,
    transform: document.transform ?? null,
    steps: document.steps ?? [],
    output: document.output ?? {},
    expression: document.expression ?? null,
  }
}

function resolveMaterializationStrategy(document: DataViewSourceDocument): DataViewMaterializationStrategy {
  if (document.incremental.mode === 'full' || document.mode === 'manual' || document.mode === 'projection' || document.mode === 'expression')
    return { kind: 'full' }
  if (document.incremental.mode === 'collection-by-key')
    return { kind: 'collection-by-key', key: document.incremental.key }
  return isRowLocalPipeline(document.steps ?? [], 'id')
    ? { kind: 'collection-by-key', key: 'id' }
    : { kind: 'full' }
}

function isRowLocalPipeline(steps: DataViewPipelineStep[], key: string): boolean {
  if (steps.length !== 2 || steps[0]?.type !== 'from' || steps[1]?.type !== 'map')
    return false
  const from = steps[0]
  const map = steps[1]
  if (from.source !== '' || from.dataViews?.length)
    return false
  const keyExpression = map.fields[key]
  if (!keyExpression || keyExpression.type !== 'path' || keyExpression.path !== `${from.as}.${key}` || keyExpression.operations.length)
    return false
  if (map.spreads.some(spread => spread.source !== from.as))
    return false
  return Object.values(map.fields).every(expression => isRowLocalExpression(expression, from.as))
}

function isRowLocalExpression(expression: DataViewExpression, alias: string): boolean {
  if (expression.type === 'literal')
    return true
  if (expression.type === 'path')
    return expression.path === alias || expression.path.startsWith(`${alias}.`)
  if (expression.type === 'template') {
    const placeholders = [...expression.template.matchAll(/\{([^{}]+)\}/g)]
    return placeholders.every(match => {
      const path = String(match[1] ?? '').trim()
      return path === alias || path.startsWith(`${alias}.`)
    })
  }
  if (expression.type === 'read')
    return expression.source === 'scope' && (expression.path === alias || expression.path.startsWith(`${alias}.`))
  if (expression.type === 'operation')
    return expression.arguments.every(argument => isRowLocalExpression(argument, alias))
  if (expression.type === 'array')
    return expression.items.every(argument => isRowLocalExpression(argument, alias))
  if (expression.type === 'object')
    return Object.values(expression.properties).every(argument => isRowLocalExpression(argument, alias))
  return false
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
  return readStringArgumentFromArgs(node.arguments, index)
}

function readStringArgumentFromArgs(args: t.CallExpression['arguments'], index: number): string | null {
  const arg = args[index]
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

function isManualDataViewDefinition(node: t.Node | null | undefined): boolean {
  if (!node || !t.isExpression(node))
    return false

  const definition = unwrapExpression(node)
  if (!t.isObjectExpression(definition))
    return false

  const mode = readStringProperty(definition, 'mode')
  const hasTransform = definition.properties.some(property =>
    (t.isObjectMethod(property) || t.isObjectProperty(property)) && getPropertyName(property.key) === 'transform',
  )
  const hasSteps = Boolean(readPropertyValue(definition, 'steps'))
  return mode === 'manual' || (hasTransform && !hasSteps)
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
