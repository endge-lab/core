import type { RQueryAuth } from '@/domain/types/document/query.types'
import type { ProgramDiagnostic, QueryProgramPayload } from '@/domain/types/program/program.types'
import type { DataViewRef } from '@/domain/types/source/data-view-source.types'
import type {
  QueryOutputSource,
  QuerySourceCompileResult,
  QuerySourceDocument,
  QuerySourceOutput,
  QuerySourceRequestValue,
} from '@/domain/types/source/query-source.types'
import type { ResponseOutputTransform } from '@/domain/types/source/response-output.types'
import type { QueryProgramProp, SourceExpressionIR } from '@/domain/types/source/source-expression.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'
import { Kind, parse as parseGraphQL } from 'graphql'

import { QueryType } from '@/domain/types/document/document.types'
import { compileSourceCallback, compileSourceExpression } from '@/model/services/source-engine/compilers/source-expression-compile'
import { compileSourceField } from '@/model/services/source-engine/compilers/source-field-compile'
import { compileProgramMetadataProperty } from '@/model/services/source-engine/compilers/source-metadata-compile'
import { readSourceModelReference } from '@/model/services/source-engine/compilers/source-model-reference-compile'

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
      return { ast, document: null, artifact: null, metadata: {}, diagnostics }
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
      return { ast, document: null, artifact: null, metadata: {}, diagnostics }
    }

    const metadata = compileProgramMetadataProperty(definition, diagnostics)
    const document = parseDocument(definition, source, diagnostics)
    const hasErrors = diagnostics.some(diagnostic => diagnostic.severity === 'error')

    return {
      ast,
      document: hasErrors ? null : document,
      artifact: hasErrors ? null : createQueryArtifact(document),
      metadata,
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
      metadata: {},
      diagnostics,
    }
  }
}

function findDefineQueryCall(ast: t.File): t.CallExpression | null {
  for (const statement of ast.program.body) {
    if (!t.isExpressionStatement(statement)) {
      continue
    }

    const expression = unwrapExpression(statement.expression)
    if (!t.isCallExpression(expression)) {
      continue
    }

    if (t.isIdentifier(expression.callee, { name: 'defineQuery' })) {
      return expression
    }
  }

  return null
}

function parseDocument(
  node: t.ObjectExpression,
  source: string,
  diagnostics: DiagnosticDraft[],
): QuerySourceDocument {
  const kind = readStringProperty(node, 'kind') ?? 'rest'
  if (kind !== 'rest' && kind !== 'graphql') {
    diagnostics.push(createDiagnostic(
      'error',
      'query-source-kind-unsupported',
      `Query source kind "${kind}" не поддерживается.`,
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
  const endpoint = requestNode ? readRequestValue(requestNode, 'endpoint', '', diagnostics, readStringRequestValue) : ''
  const headers = requestNode ? readRequestValue(requestNode, 'headers', {}, diagnostics, readHeadersRequestValue) : {}
  const auth = requestNode ? readRequestValue(requestNode, 'auth', { mode: 'inherit' }, diagnostics, readAuthRequestValue) : { mode: 'inherit' as const }
  const timeoutMs = requestNode ? readOptionalRequestValue(requestNode, 'timeoutMs', diagnostics, readNumberRequestValue) : undefined
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
  validateRequestPropReferences(endpoint, propKeys, diagnostics, 'request.endpoint')
  validateRequestPropReferences(headers, propKeys, diagnostics, 'request.headers')
  validateRequestPropReferences(auth, propKeys, diagnostics, 'request.auth')
  validateRequestPropReferences(timeoutMs, propKeys, diagnostics, 'request.timeoutMs')
  const common = {
    props,
    outputs: outputsNode ? readOutputs(outputsNode, source, diagnostics, kind) : [],
    mock: {
      enabled: mockNode ? readBooleanProperty(mockNode, 'enabled') ?? false : false,
      data: mockNode ? readUnknownProperty(mockNode, 'data', diagnostics) ?? null : null,
    },
  }

  if (kind === 'graphql') {
    rejectRequestProperties(requestNode, ['path', 'method', 'formUrlencoded', 'body'], diagnostics, 'graphql')
    const graphQL = requestNode
      ? readGraphQLRequest(requestNode, diagnostics)
      : { document: '', operationName: undefined, variables: null, errorPolicy: 'throw' as const }
    validateRequestPropReferences(graphQL.variables, propKeys, diagnostics, 'request.variables')
    return {
      kind: 'graphql',
      request: {
        endpoint,
        document: graphQL.document,
        operationName: graphQL.operationName,
        variables: graphQL.variables,
        headers,
        auth,
        timeoutMs,
        errorPolicy: graphQL.errorPolicy,
      },
      ...common,
    }
  }

  rejectRequestProperties(requestNode, ['document', 'operationName', 'variables', 'errorPolicy'], diagnostics, 'rest')
  const requestBodyNode = requestNode ? readPropertyValue(requestNode, 'body') : null
  const requestBody = requestBodyNode ? readRequestBody(requestBodyNode, diagnostics) : null
  const path = requestNode ? readRequestValue(requestNode, 'path', '', diagnostics, readStringRequestValue) : ''
  const method = requestNode ? readRequestValue(requestNode, 'method', 'POST', diagnostics, readStringRequestValue) : 'POST'
  const formUrlencoded = requestNode ? readOptionalRequestValue(requestNode, 'formUrlencoded', diagnostics, readBooleanRequestValue) : undefined
  validateRequestPropReferences(requestBody, propKeys, diagnostics, 'request.body')
  validateRequestPropReferences(path, propKeys, diagnostics, 'request.path')
  validateRequestPropReferences(method, propKeys, diagnostics, 'request.method')
  validateRequestPropReferences(formUrlencoded, propKeys, diagnostics, 'request.formUrlencoded')
  return {
    kind: 'rest',
    request: { endpoint, path, method, headers, auth, timeoutMs, formUrlencoded, body: requestBody },
    ...common,
  }
}

function createQueryArtifact(document: QuerySourceDocument): QueryProgramPayload {
  if (document.kind === 'graphql') {
    return {
      type: QueryType.GraphQL,
      sourceVersion: 2,
      endpoint: document.request.endpoint,
      query: document.request.document,
      operationName: document.request.operationName,
      errorPolicy: document.request.errorPolicy,
      headers: document.request.headers,
      auth: document.request.auth,
      timeoutMs: document.request.timeoutMs,
      props: document.props,
      requestBody: null,
      requestVariables: document.request.variables ?? null,
      mockDataEnabled: document.mock.enabled,
      mockData: document.mock.data,
      outputs: createQueryOutputs(document),
    }
  }

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
    outputs: createQueryOutputs(document),
  }
}

function createQueryOutputs(document: QuerySourceDocument): QueryProgramPayload['outputs'] {
  return document.outputs.map(output => ({
    key: output.key,
    source: output.source,
    transforms: output.transforms,
    dataViews: output.dataViews,
    contract: output.contract,
    materialization: output.source.type === 'response' && output.transforms.length === 0
      ? { kind: 'source' as const }
      : { kind: 'derived' as const, strategy: { kind: 'full' as const } },
  }))
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

function readGraphQLRequest(
  node: t.ObjectExpression,
  diagnostics: DiagnosticDraft[],
): {
  document: string
  operationName: string | undefined
  variables: SourceExpressionIR | null
  errorPolicy: 'throw' | 'ignore'
} {
  const documentNode = readPropertyValue(node, 'document')
  const document = documentNode ? readGraphQLDocument(documentNode, diagnostics) : ''
  if (!documentNode) {
    diagnostics.push(createDiagnostic(
      'error',
      'query-source-graphql-document-missing',
      'GraphQL request должен содержать document: gql`...`.',
      'request.document',
    ))
  }

  const operationNameNode = readPropertyValue(node, 'operationName')
  const operationName = operationNameNode
    ? readStaticString(operationNameNode, diagnostics, 'request.operationName')
    : undefined
  const variablesNode = readPropertyValue(node, 'variables')
  const variables = variablesNode ? readGraphQLVariables(variablesNode, diagnostics) : null
  const errorPolicyNode = readPropertyValue(node, 'errorPolicy')
  const rawErrorPolicy = errorPolicyNode
    ? readStaticString(errorPolicyNode, diagnostics, 'request.errorPolicy')
    : 'throw'
  const errorPolicy = rawErrorPolicy === 'ignore' ? 'ignore' : 'throw'
  if (rawErrorPolicy && rawErrorPolicy !== 'throw' && rawErrorPolicy !== 'ignore') {
    diagnostics.push(createDiagnostic(
      'error',
      'query-source-graphql-error-policy',
      'request.errorPolicy поддерживает только "throw" или "ignore".',
      'request.errorPolicy',
      errorPolicyNode ?? undefined,
    ))
  }

  return {
    document,
    operationName: validateGraphQLDocument(document, operationName, diagnostics, documentNode ?? undefined),
    variables,
    errorPolicy,
  }
}

function readGraphQLDocument(
  node: t.Expression,
  diagnostics: DiagnosticDraft[],
): string {
  const expression = unwrapExpression(node)
  if (
    t.isTaggedTemplateExpression(expression)
    && t.isIdentifier(expression.tag, { name: 'gql' })
    && expression.quasi.expressions.length === 0
  ) {
    return expression.quasi.quasis[0]?.value.cooked ?? ''
  }

  if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'gql' })) {
    const value = expression.arguments[0]
    if (value && t.isExpression(value)) {
      const parsed = readStaticString(value, diagnostics, 'request.document')
      if (parsed !== undefined) {
        return parsed
      }
    }
  }

  diagnostics.push(createDiagnostic(
    'error',
    'query-source-graphql-document-shape',
    'request.document должен быть статическим gql`...` без JavaScript interpolation.',
    'request.document',
    expression,
  ))
  return ''
}

function readGraphQLVariables(
  node: t.Expression,
  diagnostics: DiagnosticDraft[],
): SourceExpressionIR | null {
  const expression = unwrapExpression(node)
  if (!t.isCallExpression(expression) || !t.isIdentifier(expression.callee, { name: 'variables' })) {
    diagnostics.push(createDiagnostic(
      'error',
      'query-source-graphql-variables-shape',
      'request.variables должен быть variables(callback).',
      'request.variables',
      expression,
    ))
    return null
  }
  return compileSourceCallback(expression.arguments[0], diagnostics, 'request.variables')
}

function validateGraphQLDocument(
  document: string,
  requestedOperationName: string | undefined,
  diagnostics: DiagnosticDraft[],
  node?: t.Node,
): string | undefined {
  if (!document.trim()) {
    return requestedOperationName
  }

  try {
    const parsed = parseGraphQL(document)
    const operations = parsed.definitions.filter(definition => definition.kind === Kind.OPERATION_DEFINITION)
    if (operations.length === 0) {
      diagnostics.push(createDiagnostic(
        'error',
        'query-source-graphql-operation-missing',
        'GraphQL document должен содержать query или mutation operation.',
        'request.document',
        node,
      ))
      return requestedOperationName
    }
    if (operations.some(operation => operation.operation === 'subscription')) {
      diagnostics.push(createDiagnostic(
        'error',
        'query-source-graphql-subscription-unsupported',
        'GraphQL subscriptions не поддерживаются Query executor.',
        'request.document',
        node,
      ))
    }

    if (requestedOperationName) {
      if (!operations.some(operation => operation.name?.value === requestedOperationName)) {
        diagnostics.push(createDiagnostic(
          'error',
          'query-source-graphql-operation-unknown',
          `Operation "${requestedOperationName}" не найдена в GraphQL document.`,
          'request.operationName',
          node,
        ))
      }
      return requestedOperationName
    }

    if (operations.length > 1) {
      diagnostics.push(createDiagnostic(
        'error',
        'query-source-graphql-operation-name-required',
        'Для GraphQL document с несколькими operations укажите request.operationName.',
        'request.operationName',
        node,
      ))
      return undefined
    }
    return operations[0]?.name?.value
  }
  catch (error: any) {
    diagnostics.push(createDiagnostic(
      'error',
      'query-source-graphql-document-invalid',
      `Некорректный GraphQL document: ${error?.message ?? error}`,
      'request.document',
      node,
    ))
    return requestedOperationName
  }
}

function readStaticString(
  node: t.Expression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): string | undefined {
  const expression = unwrapExpression(node)
  if (t.isStringLiteral(expression)) {
    return expression.value
  }
  if (t.isTemplateLiteral(expression) && expression.expressions.length === 0) {
    return expression.quasis[0]?.value.cooked ?? ''
  }
  diagnostics.push(createDiagnostic(
    'error',
    'query-source-static-string-required',
    `${sourcePath} должен быть статической строкой.`,
    sourcePath,
    expression,
  ))
  return undefined
}

function rejectRequestProperties(
  node: t.ObjectExpression | null,
  keys: string[],
  diagnostics: DiagnosticDraft[],
  kind: 'rest' | 'graphql',
): void {
  if (!node) {
    return
  }
  for (const key of keys) {
    const value = readPropertyValue(node, key)
    if (!value) {
      continue
    }
    diagnostics.push(createDiagnostic(
      'error',
      'query-source-request-property-unsupported',
      `request.${key} не поддерживается для kind: "${kind}".`,
      `request.${key}`,
      value,
    ))
  }
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
    if (!key) {
      continue
    }
    if (declared.has(key)) {
      diagnostics.push(createDiagnostic('error', 'query-source-prop-duplicate', `Prop "${key}" объявлен повторно.`, `props.${key}`, property))
      continue
    }
    declared.add(key)
    const parsed = compileSourceField(key, property.value, source, diagnostics, `props.${key}`, {
      allowInlineTypeExpressions: true,
    })
    if (parsed) {
      props.push({ ...parsed.field, defaultSource: parsed.defaultSource })
    }
  }
  return props
}

function readOutputs(
  node: t.ObjectExpression,
  source: string,
  diagnostics: DiagnosticDraft[],
  kind: string,
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
    if (!key || !t.isExpression(property.value)) {
      continue
    }

    if (declared.has(key)) {
      diagnostics.push(createDiagnostic(
        'error',
        'query-source-output-duplicate',
        `Output "${key}" объявлен повторно.`,
        `outputs.${key}`,
      ))
      continue
    }

    const output = readOutput(key, unwrapExpression(property.value), source, diagnostics, kind)
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

function validateRequestPropReferences(
  expression: QuerySourceRequestValue<unknown> | null | undefined,
  propKeys: Set<string>,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): void {
  if (!isSourceExpression(expression)) {
    return
  }
  const visit = (node: SourceExpressionIR) => {
    if (node.type === 'read') {
      if (node.source === 'current' || node.source === 'env') {
        return
      }
      if (node.source !== 'prop') {
        diagnostics.push(createDiagnostic('error', 'query-source-request-read', `${sourcePath} не поддерживает read source "${node.source}".`, sourcePath))
      }
      else if (!propKeys.has(node.path)) {
        diagnostics.push(createDiagnostic('error', 'query-source-request-prop-missing', `Prop "${node.path}" не объявлен в defineProps.`, sourcePath))
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
  kind: string,
): QuerySourceOutput | null {
  const calls = collectMemberCallChain(node)
  if (!calls) {
    return unsupportedOutput(key, diagnostics, node)
  }

  let outputSource: QueryOutputSource | null = null
  const dataViews: DataViewRef[] = []
  const transforms: ResponseOutputTransform[] = []
  let contract: QuerySourceOutput['contract'] = null

  for (const call of calls.modifiers) {
    if (call.name === 'from') {
      outputSource = readOutputSource(call.arguments[0], diagnostics, `outputs.${key}.from`, kind)
      continue
    }

    if (call.name === 'dataView') {
      const dataViewRef = readDataViewRef(call.arguments[0], source, diagnostics, `outputs.${key}.dataView`)
      if (dataViewRef) {
        dataViews.push(dataViewRef)
        transforms.push({ kind: 'data-view', ref: dataViewRef })
      }
      continue
    }

    if (call.name === 'convert') {
      const transform = readConverterTransform(call.arguments, diagnostics, `outputs.${key}.convert`)
      if (transform) {
        transforms.push(transform)
      }
      continue
    }

    if (call.name === 'contract') {
      if (contract) {
        diagnostics.push(createDiagnostic(
          'error',
          'query-source-output-contract-duplicate',
          `Output "${key}" содержит повторный .contract(...).`,
          `outputs.${key}.contract`,
        ))
        continue
      }
      const raw = call.arguments[0]
      if (!raw || !t.isExpression(raw)) {
        diagnostics.push(createDiagnostic(
          'error',
          'query-source-output-contract-missing',
          'output().contract(...) требует field(type).',
          `outputs.${key}.contract`,
        ))
        continue
      }
      contract = compileSourceField(key, raw, source, diagnostics, `outputs.${key}.contract`, {
        allowInlineTypeExpressions: true,
      })?.field ?? null
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

  return { key, source: outputSource, transforms, dataViews, contract }
}

function readConverterTransform(
  args: t.CallExpression['arguments'],
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): Extract<ResponseOutputTransform, { kind: 'converter' }> | null {
  const raw = args[0]
  let identity = ''
  if (t.isStringLiteral(raw)) {
    identity = raw.value.trim()
  }
  else if (t.isCallExpression(raw) && t.isIdentifier(raw.callee, { name: 'converter' }) && t.isStringLiteral(raw.arguments[0])) {
    identity = raw.arguments[0].value.trim()
  }
  if (!identity) {
    diagnostics.push(createDiagnostic(
      'error',
      'query-source-output-converter-invalid',
      '.convert(...) требует identity Converter строкой или converter("identity").',
      sourcePath,
      raw && t.isNode(raw) ? raw : undefined,
    ))
    return null
  }

  const optionsNode = args[1]
  if (!optionsNode) {
    return { kind: 'converter', identity }
  }
  if (!t.isExpression(optionsNode)) {
    diagnostics.push(createDiagnostic('error', 'query-source-output-converter-options-invalid', 'Converter options должны быть объектом.', sourcePath))
    return null
  }
  const options = expressionToUnknown(optionsNode, diagnostics, `${sourcePath}.options`)
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    diagnostics.push(createDiagnostic('error', 'query-source-output-converter-options-invalid', 'Converter options должны быть статическим объектом.', sourcePath, optionsNode))
    return null
  }
  return { kind: 'converter', identity, options: options as Record<string, unknown> }
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
    if (!name || !t.isExpression(current.callee.object)) {
      return null
    }

    modifiers.unshift({ name, arguments: current.arguments })
    current = unwrapExpression(current.callee.object)
  }

  if (!t.isCallExpression(current) || !t.isIdentifier(current.callee, { name: 'output' })) {
    return null
  }

  return { modifiers }
}

function readOutputSource(
  node: t.CallExpression['arguments'][number] | undefined,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
  kind: string,
): QueryOutputSource | null {
  if (!node || !t.isExpression(node)) {
    diagnostics.push(createDiagnostic('error', 'query-source-output-source-missing', '.from(...) должен получить источник.', sourcePath))
    return null
  }

  const expression = unwrapExpression(node)
  if (t.isStringLiteral(expression)) {
    return { type: 'output', key: expression.value }
  }

  const isDataCall = t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'data' })
  if (isDataCall && kind !== 'graphql') {
    diagnostics.push(createDiagnostic(
      'error',
      'query-source-graphql-data-rest',
      'data(...) доступен только для kind: "graphql". Для REST используйте response(...).',
      sourcePath,
      expression,
    ))
    return null
  }

  if (
    t.isCallExpression(expression)
    && (t.isIdentifier(expression.callee, { name: 'response' }) || isDataCall)
  ) {
    const path = expression.arguments[0]
    if (!path) {
      return { type: 'response', path: null }
    }
    if (t.isStringLiteral(path)) {
      return { type: 'response', path: path.value }
    }
  }

  if (kind !== 'graphql' && containsCallNamed(expression, 'data')) {
    diagnostics.push(createDiagnostic(
      'error',
      'query-source-graphql-data-rest',
      'data(...) доступен только для kind: "graphql". Для REST используйте response(...).',
      sourcePath,
      expression,
    ))
    return null
  }

  const compiled = compileSourceExpression(
    kind === 'graphql' ? normalizeGraphQLDataReads(expression) : expression,
    diagnostics,
    sourcePath,
  )
  if (compiled && containsOnlyReads(compiled, new Set(['response', 'current']))) {
    return { type: 'response', path: null, expression: compiled }
  }
  if (compiled) {
    diagnostics.push(createDiagnostic('error', 'query-source-output-read', 'Query output expression может читать только response(...).', sourcePath, expression))
  }

  diagnostics.push(createDiagnostic(
    'error',
    'query-source-output-source-unsupported',
    '.from(...) поддерживает response(path?) с value-цепочкой или ключ предыдущего output.',
    sourcePath,
    expression,
  ))
  return null
}

function containsCallNamed(node: t.Node, name: string): boolean {
  let found = false
  t.traverseFast(node, (child) => {
    if (t.isCallExpression(child) && t.isIdentifier(child.callee, { name })) {
      found = true
    }
  })
  return found
}

function normalizeGraphQLDataReads(node: t.Expression): t.Expression {
  const normalized = t.cloneNode(node, true)
  t.traverseFast(normalized, (child) => {
    if (t.isCallExpression(child) && t.isIdentifier(child.callee, { name: 'data' })) {
      child.callee.name = 'response'
    }
  })
  return normalized
}

function containsOnlyReads(
  expression: import('@/domain/types/source/source-expression.types').SourceExpressionIR,
  allowed: Set<import('@/domain/types/source/source-expression.types').SourceExpressionReadKind>,
): boolean {
  if (expression.type === 'read') {
    return allowed.has(expression.source)
  }
  if (expression.type === 'operation') {
    return expression.arguments.every(argument => containsOnlyReads(argument, allowed))
  }
  if (expression.type === 'array') {
    return expression.items.every(argument => containsOnlyReads(argument, allowed))
  }
  if (expression.type === 'object') {
    return Object.values(expression.properties).every(argument => containsOnlyReads(argument, allowed))
  }
  return true
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

  const reference = readSourceModelReference(node, source, {
    referenceCall: 'dataView',
    defineCall: 'defineDataView',
  })
  if (reference?.kind === 'external') {
    return reference
  }

  if (reference?.kind === 'inline') {
    if (isManualDataViewDefinition(reference.definition.arguments[0])) {
      diagnostics.push(createDiagnostic(
        'error',
        'query-source-local-dataview-manual-unsupported',
        'Локальные DataView внутри query в v1 поддерживают только mode: pipeline.',
        sourcePath,
        reference.definition,
      ))
    }
    return { kind: 'inline', source: reference.source }
  }

  diagnostics.push(createDiagnostic(
    'error',
    'query-source-output-dataview-unsupported',
    '.dataView(...) поддерживает "identity", dataView("identity") или defineDataView({...}).',
    sourcePath,
    unwrapExpression(node),
  ))
  return null
}

function isManualDataViewDefinition(node: t.Node | null | undefined): boolean {
  if (!node || !t.isObjectExpression(unwrapExpression(node as t.Expression))) {
    return false
  }

  const definition = unwrapExpression(node as t.Expression) as t.ObjectExpression
  const mode = readStringProperty(definition, 'mode')
  const hasTransform = definition.properties.some(property =>
    (t.isObjectMethod(property) || t.isObjectProperty(property)) && getPropertyName(property.key) === 'transform',
  )
  const hasSteps = Boolean(readPropertyValue(definition, 'steps'))
  return mode === 'manual' || (hasTransform && !hasSteps)
}

type StaticRequestValueReader<T> = (
  value: unknown,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
) => T | undefined

function readRequestValue<T>(
  node: t.ObjectExpression,
  key: string,
  fallback: T,
  diagnostics: DiagnosticDraft[],
  readStatic: StaticRequestValueReader<T>,
): QuerySourceRequestValue<T> {
  return readOptionalRequestValue(node, key, diagnostics, readStatic) ?? fallback
}

function readOptionalRequestValue<T>(
  node: t.ObjectExpression,
  key: string,
  diagnostics: DiagnosticDraft[],
  readStatic: StaticRequestValueReader<T>,
): QuerySourceRequestValue<T> | undefined {
  const value = readPropertyValue(node, key)
  if (!value) {
    return undefined
  }

  const sourcePath = `request.${key}`
  if (!isStaticRequestExpression(value)) {
    return compileSourceExpression(value, diagnostics, sourcePath) ?? undefined
  }

  const parsed = expressionToUnknown(value, diagnostics, sourcePath)
  const normalized = readStatic(parsed, diagnostics, sourcePath)
  if (normalized === undefined) {
    diagnostics.push(createDiagnostic(
      'error',
      'query-source-request-value-type',
      `${sourcePath} содержит значение недопустимого типа.`,
      sourcePath,
      value,
    ))
  }
  return normalized
}

function readStringRequestValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readNumberRequestValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function readBooleanRequestValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function readHeadersRequestValue(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, String(entry)]))
}

function readAuthRequestValue(value: unknown): RQueryAuth | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const auth = value as Partial<RQueryAuth>
  if (auth.mode === 'none') {
    return { ...auth, mode: 'none' }
  }
  if (auth.mode === 'profile') {
    const profile = typeof auth.profile === 'string' ? auth.profile.trim() : ''
    return profile ? { ...auth, mode: 'profile', profile } : undefined
  }
  if (auth.mode === 'inherit' || auth.mode == null) {
    return { ...auth, mode: 'inherit' }
  }
  return undefined
}

function isStaticRequestExpression(node: t.Expression): boolean {
  const expression = unwrapExpression(node)
  if (
    t.isStringLiteral(expression)
    || t.isNumericLiteral(expression)
    || t.isBooleanLiteral(expression)
    || t.isNullLiteral(expression)
    || t.isIdentifier(expression, { name: 'undefined' })
    || (t.isTemplateLiteral(expression) && expression.expressions.length === 0)
    || isVarCall(expression)
  ) {
    return true
  }
  if (t.isArrayExpression(expression)) {
    return expression.elements.every(item => item != null && t.isExpression(item) && isStaticRequestExpression(item))
  }
  if (t.isObjectExpression(expression)) {
    return expression.properties.every(property =>
      t.isObjectProperty(property)
      && !property.computed
      && t.isExpression(property.value)
      && isStaticRequestExpression(property.value),
    )
  }
  return false
}

function isSourceExpression(value: unknown): value is SourceExpressionIR {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const candidate = value as Record<string, unknown>
  if (candidate.type === 'literal') {
    return Object.hasOwn(candidate, 'value')
  }
  if (candidate.type === 'object') {
    return Boolean(candidate.properties && typeof candidate.properties === 'object' && !Array.isArray(candidate.properties))
  }
  if (candidate.type === 'array') {
    return Array.isArray(candidate.items)
  }
  if (candidate.type === 'read') {
    return typeof candidate.source === 'string' && typeof candidate.path === 'string'
  }
  if (candidate.type === 'operation') {
    return typeof candidate.operation === 'string' && Array.isArray(candidate.arguments)
  }
  return false
}

function readStringProperty(node: t.ObjectExpression, key: string): string | null {
  const value = readPropertyValue(node, key)
  const expression = value ? unwrapExpression(value) : null
  return expression && t.isStringLiteral(expression) ? expression.value : null
}

function readBooleanProperty(node: t.ObjectExpression, key: string): boolean | undefined {
  const value = readPropertyValue(node, key)
  const expression = value ? unwrapExpression(value) : null
  if (expression && t.isBooleanLiteral(expression)) {
    return expression.value
  }
  return undefined
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
    if (!t.isObjectProperty(property) || property.computed) {
      continue
    }

    if (getPropertyName(property.key) === key) {
      return unwrapExpression(property.value as t.Expression)
    }
  }

  return null
}

function expressionToUnknown(
  node: t.Node | null | undefined,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): unknown {
  if (!node) {
    return undefined
  }

  const expression = unwrapExpression(node as t.Expression)

  if (t.isStringLiteral(expression)) {
    return expression.value
  }
  if (t.isNumericLiteral(expression)) {
    return expression.value
  }
  if (t.isBooleanLiteral(expression)) {
    return expression.value
  }
  if (t.isNullLiteral(expression)) {
    return null
  }
  if (t.isIdentifier(expression, { name: 'undefined' })) {
    return undefined
  }
  if (t.isTemplateLiteral(expression) && expression.expressions.length === 0) {
    return expression.quasis[0]?.value.cooked ?? ''
  }
  if (t.isArrayExpression(expression)) {
    return expression.elements.map(item => expressionToUnknown(item as t.Expression, diagnostics, sourcePath))
  }
  if (t.isObjectExpression(expression)) {
    return objectExpressionToRecord(expression, diagnostics, sourcePath)
  }
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
    if (!key) {
      continue
    }

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
  if (t.isIdentifier(key)) {
    return key.name
  }
  if (t.isStringLiteral(key)) {
    return key.value
  }
  if (t.isNumericLiteral(key)) {
    return String(key.value)
  }
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
