import type { ProgramDiagnostic } from '@/features/core/modules/program/domain/types/program.types'
import type { QueryGraphQLErrorPolicy } from '@/features/core/modules/source/domain/types/query-source.types'
import type { SourceExpressionIR } from '@/features/core/modules/source/domain/types/source-expression.types'
import type {
  StreamEventDescriptor,
  StreamGraphQLSseTransportDescriptor,
  StreamJsonValue,
  StreamProgramProp,
  StreamSourceCompileResult,
  StreamSseTransportDescriptor,
  StreamTransportDescriptor,
} from '@/features/core/modules/source/domain/types/stream-source.types'
import type { GraphQLOperationSourceOptions } from '@/features/core/modules/source/services/compilers/graphql-operation-compile'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import {
  applyGraphQLFragmentsSource,
  readGraphQLDocumentSource,
  readGraphQLFragmentsSource,
  readGraphQLVariablesSource,
  readStaticStringSource,
  validateGraphQLOperationSource,
  validateGraphQLVariablesSource,
} from '@/features/core/modules/source/services/compilers/graphql-operation-compile'
import { compileSourceExpression, diagnostic, propertyName, readStringArgument, unwrapExpression } from '@/features/core/modules/source/services/compilers/source-expression-compile'
import { compileSourceField } from '@/features/core/modules/source/services/compilers/source-field-compile'
import { compileProgramMetadataProperty } from '@/features/core/modules/source/services/compilers/source-metadata-compile'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

const TRANSPORT_CALLEES = ['sse', 'websocket', 'graphqlSse']
const GRAPHQL_SSE_EVENTS = ['next', 'complete']
const GRAPHQL_SSE_PROPERTIES = ['url', 'method', 'document', 'fragments', 'operationName', 'variables', 'headers', 'extensions', 'withCredentials', 'auth', 'errorPolicy', 'reconnectDelay']
const GRAPHQL_ERROR_POLICIES: readonly QueryGraphQLErrorPolicy[] = ['throw', 'ignore', 'all']
const DEFAULT_GRAPHQL_SSE_RECONNECT_DELAY_MS = 3000
const GRAPHQL_SUBSCRIPTION_OPERATION: GraphQLOperationSourceOptions = {
  codePrefix: 'stream',
  sourcePathPrefix: 'transport',
  operations: ['subscription'],
  unsupportedOperation: {
    code: 'stream-graphql-operation-unsupported',
    message: 'graphqlSse поддерживает только subscription operation; query и mutation выполняйте через Query.',
  },
}

// Компилирует декларативный source Stream без открытия транспорта.
export function compileStreamSource(source: string, sourceVersion = 1): StreamSourceCompileResult {
  const diagnostics: DiagnosticDraft[] = []
  if (!String(source ?? '').trim()) {
    diagnostics.push(diagnostic('error', 'stream-source-empty', 'Stream source пуст.'))
    return { ast: null, document: null, artifact: null, metadata: {}, diagnostics }
  }

  try {
    const ast = parseTS(source, { sourceType: 'module', plugins: ['typescript'] })
    const call = findDefinition(ast, 'defineStream')
    const definition = call?.arguments[0]
    if (!call || !definition || !t.isObjectExpression(definition)) {
      diagnostics.push(diagnostic('error', 'stream-source-definition', 'Stream source должен содержать defineStream({...}).'))
      return { ast, document: null, artifact: null, metadata: {}, diagnostics }
    }

    const metadata = compileProgramMetadataProperty(definition, diagnostics)
    let transport: StreamTransportDescriptor | null = null
    let events: StreamEventDescriptor[] = []
    let props: StreamProgramProp[] | null = null
    for (const property of definition.properties) {
      if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
        diagnostics.push(diagnostic('error', 'stream-source-property', 'defineStream допускает только обычные properties.', 'defineStream', property))
        continue
      }
      const name = propertyName(property.key)
      const value = unwrapExpression(property.value)
      if (name === 'metadata') {
        continue
      }
      if (name === 'props') {
        props = readProps(value, source, diagnostics)
        continue
      }
      if (name === 'transport') {
        if (!t.isCallExpression(value) || !t.isIdentifier(value.callee) || !TRANSPORT_CALLEES.includes(value.callee.name) || value.arguments.length !== 1 || !t.isObjectExpression(value.arguments[0])) {
          diagnostics.push(diagnostic('error', 'stream-transport-shape', 'transport должен иметь вид sse({ url, withCredentials?, auth? }), websocket({ url, onOpen? }) или graphqlSse({ url, document, variables?, headers?, ... }).', 'transport', value))
          continue
        }
        const transportDefinition = value.arguments[0]
        const config = readObject(transportDefinition)
        if (value.callee.name === 'graphqlSse') {
          const urlExpression = readGraphQLSseUrlExpression(transportDefinition, diagnostics)
          if (urlExpression !== undefined) {
            if (urlExpression) {
              transport = { ...readGraphQLSseTransport(transportDefinition, '', diagnostics), urlExpression }
            }
            continue
          }
        }
        const url = readEnvironmentStringProperty(transportDefinition, 'url', diagnostics, 'transport.url')
        if (!url) {
          if (!diagnostics.some(item => item.sourcePath === 'transport.url')) {
            diagnostics.push(diagnostic('error', 'stream-transport-url', 'Stream transport требует непустой url или env(...).', 'transport.url', value))
          }
          continue
        }
        if (value.callee.name === 'graphqlSse') {
          transport = readGraphQLSseTransport(transportDefinition, url, diagnostics)
          continue
        }
        if (value.callee.name === 'websocket') {
          let onOpen: StreamJsonValue[] = []
          for (const item of transportDefinition.properties) {
            if (!t.isObjectProperty(item) || item.computed || !t.isExpression(item.value)) {
              diagnostics.push(diagnostic('error', 'stream-websocket-property', 'websocket допускает только обычные url и onOpen properties.', 'transport', item))
              continue
            }
            const key = propertyName(item.key)
            if (key === 'onOpen') {
              const messages = readJsonValue(unwrapExpression(item.value))
              if (!Array.isArray(messages)) {
                diagnostics.push(diagnostic('error', 'stream-websocket-on-open', 'onOpen должен быть массивом JSON literals без вызовов, spreads и вычислений.', 'transport.onOpen', item))
              }
              else {
                onOpen = messages
              }
            }
            else if (key !== 'url') {
              diagnostics.push(diagnostic('error', 'stream-websocket-property', `websocket не поддерживает поле "${key ?? ''}".`, 'transport', item))
            }
          }
          transport = { kind: 'websocket', url, onOpen }
        }
        else {
          transport = {
            kind: 'sse',
            url,
            withCredentials: config.withCredentials === true,
            ...readTransportAuth(transportDefinition, diagnostics),
          }
        }
        continue
      }
      if (name === 'events') {
        if (!t.isObjectExpression(value)) {
          diagnostics.push(diagnostic('error', 'stream-events-shape', 'events должен быть object literal.', 'events', value))
          continue
        }
        events = readEvents(value, diagnostics)
        continue
      }
      diagnostics.push(diagnostic('error', 'stream-source-property-unsupported', `Свойство "${name ?? ''}" не поддерживается Stream v1.`, name ?? 'defineStream', property))
    }

    if (!transport) {
      diagnostics.push(diagnostic('error', 'stream-transport-missing', 'defineStream требует transport.', 'transport', definition))
    }
    if (!events.length) {
      diagnostics.push(diagnostic('error', 'stream-events-empty', 'defineStream требует хотя бы одно событие.', 'events', definition))
    }
    if (transport?.kind === 'websocket' && events.some(event => event.sourceEvent !== 'message')) {
      diagnostics.push(diagnostic('error', 'stream-websocket-event', 'WebSocket transport поддерживает только событие message.', 'events', definition))
    }
    if (transport?.kind === 'graphql-sse') {
      validateGraphQLSseEvents(events, diagnostics, definition)
      const propKeys = new Set((props ?? []).map(prop => prop.key))
      validateTransportReads(transport.variables, propKeys, diagnostics, 'transport.variables')
      validateTransportReads(transport.headers, propKeys, diagnostics, 'transport.headers')
      validateTransportReads(transport.extensions ?? null, propKeys, diagnostics, 'transport.extensions')
      validateTransportReads(transport.urlExpression ?? null, propKeys, diagnostics, 'transport.url')
    }
    else if (transport && props) {
      diagnostics.push(diagnostic('error', 'stream-props-transport', 'props Stream поддерживаются только transport graphqlSse({...}).', 'props', definition))
    }

    const document = transport ? { ...(props ? { props } : {}), transport, events } : null
    const hasErrors = diagnostics.some(item => item.severity === 'error')
    return {
      ast,
      document: hasErrors ? null : document,
      artifact: hasErrors || !document ? null : { type: 'stream', sourceVersion, ...withoutFragmentVariants(document) },
      metadata,
      diagnostics,
    }
  }
  catch (error: any) {
    diagnostics.push(diagnostic('error', 'stream-source-parse-error', `Не удалось распарсить Stream source: ${error?.message ?? error}`))
    return { ast: null, document: null, artifact: null, metadata: {}, diagnostics }
  }
}

function readEvents(node: t.ObjectExpression, diagnostics: DiagnosticDraft[]): StreamEventDescriptor[] {
  const events: StreamEventDescriptor[] = []
  const types = new Set<string>()
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      continue
    }
    const sourceEvent = propertyName(property.key)
    const call = unwrapExpression(property.value)
    if (!sourceEvent || !t.isCallExpression(call) || !t.isIdentifier(call.callee, { name: 'event' })) {
      diagnostics.push(diagnostic('error', 'stream-event-shape', 'Stream event должен иметь вид sourceEvent: event(type[, payloadPath]) или event({ typeFrom, payloadFrom? }).', 'events', property))
      continue
    }
    const first = call.arguments[0]
    let type: string | null = null
    let typePath: string | null = null
    let payloadPath: string | null = null
    const options: Pick<StreamEventDescriptor, 'match' | 'eachFrom'> = {}
    if (first && t.isObjectExpression(first)) {
      const config = readObject(first)
      type = typeof config.type === 'string' ? config.type.trim() || null : null
      typePath = typeof config.typeFrom === 'string' ? config.typeFrom.trim() : null
      payloadPath = typeof config.payloadFrom === 'string' ? config.payloadFrom.trim() || null : null
      if (type && typePath) {
        diagnostics.push(diagnostic('error', 'stream-event-type-conflict', 'Укажите только type или typeFrom.', `events.${sourceEvent}`, first))
      }
      for (const item of first.properties) {
        if (!t.isObjectProperty(item) || item.computed || !t.isExpression(item.value)) {
          diagnostics.push(diagnostic('error', 'stream-event-property', 'event допускает только обычные properties.', `events.${sourceEvent}`, item))
          continue
        }
        const key = propertyName(item.key)
        const value = unwrapExpression(item.value)
        if (key === 'match') {
          const match = readJsonValue(value)
          if (!match || typeof match !== 'object' || Array.isArray(match)
            || Object.entries(match).some(([path, expected]) => !path.trim() || (expected !== null && typeof expected === 'object'))) {
            diagnostics.push(diagnostic('error', 'stream-event-match', 'match должен содержать dot-path и JSON scalar (строку, число, boolean или null).', `events.${sourceEvent}.match`, item))
          }
          else {
            options.match = match as NonNullable<StreamEventDescriptor['match']>
          }
        }
        else if (key === 'eachFrom') {
          if (!t.isStringLiteral(value)) {
            diagnostics.push(diagnostic('error', 'stream-event-each-from', 'eachFrom должен быть строковым dot-path к массиву; пустая строка означает корневой массив.', `events.${sourceEvent}.eachFrom`, item))
          }
          else {
            options.eachFrom = value.value.trim()
          }
        }
      }
    }
    else {
      type = readStringArgument(call, 0)?.trim() || null
      payloadPath = readStringArgument(call, 1)?.trim() || null
    }
    if (!type && !typePath) {
      diagnostics.push(diagnostic('error', 'stream-event-type', `Событие "${sourceEvent}" требует type или typeFrom.`, `events.${sourceEvent}`, call))
      continue
    }
    if (type && types.has(type)) {
      diagnostics.push(diagnostic('warning', 'stream-event-type-duplicate', `Несколько transport events нормализуются в "${type}".`, `events.${sourceEvent}`, call))
    }
    if (type) {
      types.add(type)
    }
    events.push({ sourceEvent, type, typePath, payloadPath, ...options })
  }
  return events
}

function readProps(
  node: t.Expression,
  source: string,
  diagnostics: DiagnosticDraft[],
): StreamProgramProp[] {
  if (!t.isCallExpression(node) || !t.isIdentifier(node.callee, { name: 'defineProps' })) {
    diagnostics.push(diagnostic('error', 'stream-props-shape', 'props должен быть defineProps({...}).', 'props', node))
    return []
  }
  const definition = node.arguments[0]
  if (!definition || !t.isObjectExpression(definition)) {
    diagnostics.push(diagnostic('error', 'stream-props-object', 'defineProps принимает object literal.', 'props', node))
    return []
  }
  const props: StreamProgramProp[] = []
  const declared = new Set<string>()
  for (const property of definition.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      diagnostics.push(diagnostic('error', 'stream-prop-property', 'defineProps допускает обычные properties.', 'props', property))
      continue
    }
    const key = propertyName(property.key)
    if (!key) {
      continue
    }
    if (declared.has(key)) {
      diagnostics.push(diagnostic('error', 'stream-prop-duplicate', `Prop "${key}" объявлен повторно.`, `props.${key}`, property))
      continue
    }
    declared.add(key)
    const parsed = compileSourceField(key, property.value, source, diagnostics, `props.${key}`, {
      allowInlineTypeExpressions: true,
    })
    if (!parsed) {
      continue
    }
    if (parsed.defaultSource) {
      diagnostics.push(diagnostic('error', 'stream-prop-default-source', `Prop "${key}": Stream поддерживает только literal default, без Filter source.`, `props.${key}`, property))
      continue
    }
    props.push(parsed.field)
  }
  return props
}

// Artifact получает только итоговый document: варианты фрагментов нужны редактору, а не runtime.
function withoutFragmentVariants<T extends { transport: StreamTransportDescriptor }>(document: T): T {
  if (document.transport.kind !== 'graphql-sse' || !document.transport.fragments) {
    return document
  }
  const { fragments: _fragments, ...transport } = document.transport
  return { ...document, transport }
}

// Читает graphqlSse({...}); url уже прочитан общим путём transport.
function readGraphQLSseTransport(
  node: t.ObjectExpression,
  url: string,
  diagnostics: DiagnosticDraft[],
): StreamGraphQLSseTransportDescriptor {
  const values = new Map<string, t.Expression>()
  for (const item of node.properties) {
    if (!t.isObjectProperty(item) || item.computed || !t.isExpression(item.value)) {
      diagnostics.push(diagnostic('error', 'stream-graphql-sse-property', 'graphqlSse допускает только обычные properties.', 'transport', item))
      continue
    }
    const key = propertyName(item.key) ?? ''
    if (!GRAPHQL_SSE_PROPERTIES.includes(key)) {
      diagnostics.push(diagnostic('error', 'stream-graphql-sse-property', `graphqlSse не поддерживает поле "${key}".`, 'transport', item))
      continue
    }
    values.set(key, item.value)
  }
  const config = readObject(node)

  const methodNode = values.get('method')
  const method = methodNode ? readStaticStringSource(methodNode, diagnostics, 'transport.method', 'stream') : 'POST'
  if (method !== undefined && method !== 'POST' && method !== 'GET') {
    diagnostics.push(diagnostic('error', 'stream-graphql-sse-method', 'transport.method поддерживает только \'POST\' или \'GET\'.', 'transport.method', methodNode))
  }

  const documentNode = values.get('document')
  const document = documentNode ? readGraphQLDocumentSource(documentNode, diagnostics, GRAPHQL_SUBSCRIPTION_OPERATION) : ''
  if (!documentNode) {
    diagnostics.push(diagnostic('error', 'stream-graphql-document-missing', 'graphqlSse требует document: gql`subscription ...`.', 'transport.document', node))
  }
  const operationNameNode = values.get('operationName')
  const requestedOperationName = operationNameNode
    ? readStaticStringSource(operationNameNode, diagnostics, 'transport.operationName', 'stream')
    : undefined
  const operationName = validateGraphQLOperationSource(document, requestedOperationName, diagnostics, GRAPHQL_SUBSCRIPTION_OPERATION, documentNode)

  const variablesNode = values.get('variables')
  const variables = variablesNode ? readGraphQLVariablesSource(variablesNode, diagnostics, GRAPHQL_SUBSCRIPTION_OPERATION) : null
  validateGraphQLVariablesSource(document, operationName, variablesNode, variables, diagnostics, GRAPHQL_SUBSCRIPTION_OPERATION, documentNode)
  const fragmentsNode = values.get('fragments')
  const fragmentsDraft = fragmentsNode ? readGraphQLFragmentsSource(fragmentsNode, diagnostics, GRAPHQL_SUBSCRIPTION_OPERATION) : null
  const composed = applyGraphQLFragmentsSource(document, operationName, fragmentsDraft, diagnostics, GRAPHQL_SUBSCRIPTION_OPERATION, documentNode)

  const headersNode = values.get('headers')
  let headers: SourceExpressionIR | null = null
  if (headersNode) {
    const expression = unwrapExpression(headersNode)
    if (!t.isObjectExpression(expression)) {
      diagnostics.push(diagnostic('error', 'stream-graphql-sse-headers', 'transport.headers должен быть object literal; значения могут читать prop(\'key\') и env(\'NAME\').', 'transport.headers', expression))
    }
    else {
      headers = compileSourceExpression(expression, diagnostics, 'transport.headers')
    }
  }

  const extensionsNode = values.get('extensions')
  let extensions: SourceExpressionIR | null = null
  if (extensionsNode) {
    const expression = unwrapExpression(extensionsNode)
    if (!t.isObjectExpression(expression)) {
      diagnostics.push(diagnostic('error', 'stream-graphql-sse-extensions', 'transport.extensions должен быть object literal; значения могут читать prop(\'key\') и env(\'NAME\').', 'transport.extensions', expression))
    }
    else {
      extensions = compileSourceExpression(expression, diagnostics, 'transport.extensions')
    }
  }

  const errorPolicyNode = values.get('errorPolicy')
  const rawErrorPolicy = errorPolicyNode
    ? readStaticStringSource(errorPolicyNode, diagnostics, 'transport.errorPolicy', 'stream')
    : 'throw'
  const errorPolicy = GRAPHQL_ERROR_POLICIES.find(policy => policy === rawErrorPolicy) ?? 'throw'
  if (rawErrorPolicy && errorPolicy !== rawErrorPolicy) {
    diagnostics.push(diagnostic('error', 'stream-graphql-error-policy', 'transport.errorPolicy поддерживает только "throw", "ignore" или "all".', 'transport.errorPolicy', errorPolicyNode))
  }

  const reconnectNode = values.get('reconnectDelay')
  let reconnectDelayMs = DEFAULT_GRAPHQL_SSE_RECONNECT_DELAY_MS
  if (reconnectNode) {
    const value = unwrapExpression(reconnectNode)
    if (!t.isNumericLiteral(value) || !Number.isFinite(value.value) || value.value < 0) {
      diagnostics.push(diagnostic('error', 'stream-graphql-sse-reconnect-delay', 'transport.reconnectDelay должен быть неотрицательным числом миллисекунд.', 'transport.reconnectDelay', value))
    }
    else {
      reconnectDelayMs = value.value
    }
  }

  const withCredentialsNode = values.get('withCredentials')
  if (withCredentialsNode && !t.isBooleanLiteral(unwrapExpression(withCredentialsNode))) {
    diagnostics.push(diagnostic('error', 'stream-graphql-sse-with-credentials', 'transport.withCredentials должен быть true или false.', 'transport.withCredentials', withCredentialsNode))
  }

  return {
    kind: 'graphql-sse',
    url,
    method: method === 'GET' ? 'GET' : 'POST',
    document: composed.document,
    ...(composed.fragments ? { fragments: composed.fragments } : {}),
    ...(operationName ? { operationName } : {}),
    variables,
    headers,
    ...(extensions ? { extensions } : {}),
    withCredentials: config.withCredentials === true,
    ...readTransportAuth(node, diagnostics),
    errorPolicy,
    reconnectDelayMs,
  }
}

// url graphqlSse как выражение: всё, кроме строки и env('NAME'), компилируется в
// SourceExpressionIR и вычисляется по props при каждом подключении. undefined — url
// не выражение (обычный путь), null — выражение с ошибкой компиляции.
function readGraphQLSseUrlExpression(node: t.ObjectExpression, diagnostics: DiagnosticDraft[]): SourceExpressionIR | null | undefined {
  const property = node.properties.find(item =>
    t.isObjectProperty(item) && !item.computed && propertyName(item.key) === 'url',
  )
  if (!property || !t.isObjectProperty(property) || !t.isExpression(property.value)) {
    return undefined
  }
  const value = unwrapExpression(property.value)
  if (
    t.isStringLiteral(value)
    || (t.isCallExpression(value) && (t.isIdentifier(value.callee, { name: 'env' }) || t.isIdentifier(value.callee, { name: 'endgeVar' })))
  ) {
    return undefined
  }
  return compileSourceExpression(value, diagnostics, 'transport.url')
}

function validateGraphQLSseEvents(events: StreamEventDescriptor[], diagnostics: DiagnosticDraft[], node: t.Node): void {
  for (const event of events) {
    if (!GRAPHQL_SSE_EVENTS.includes(event.sourceEvent)) {
      diagnostics.push(diagnostic('error', 'stream-graphql-sse-event', `graphqlSse публикует только события next и complete, а не "${event.sourceEvent}".`, `events.${event.sourceEvent}`, node))
    }
  }
  if (events.length && !events.some(event => event.sourceEvent === 'next')) {
    diagnostics.push(diagnostic('error', 'stream-graphql-sse-next-missing', 'graphqlSse требует событие next: event(...).', 'events', node))
  }
}

// Выражения transport читают только объявленные props и env(...).
function validateTransportReads(
  expression: SourceExpressionIR | null,
  propKeys: ReadonlySet<string>,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): void {
  const visit = (node: SourceExpressionIR) => {
    if (node.type === 'read') {
      if (node.source === 'env') {
        return
      }
      if (node.source !== 'prop') {
        diagnostics.push(diagnostic('error', 'stream-transport-read', `${sourcePath} не поддерживает read source "${node.source}".`, sourcePath))
      }
      else if (!propKeys.has(node.path)) {
        diagnostics.push(diagnostic('error', 'stream-transport-prop-missing', `Prop "${node.path}" не объявлен в defineProps.`, sourcePath))
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
    else if (node.type === 'transform') {
      diagnostics.push(diagnostic('error', 'stream-transport-transform', `${sourcePath} не поддерживает DataView и converter transforms.`, sourcePath))
    }
  }
  if (expression) {
    visit(expression)
  }
}

function readTransportAuth(
  node: t.ObjectExpression,
  diagnostics: DiagnosticDraft[],
): Pick<StreamSseTransportDescriptor, 'authMode' | 'authProfileIdentity'> {
  const property = node.properties.find(item =>
    t.isObjectProperty(item)
    && !item.computed
    && propertyName(item.key) === 'auth',
  )
  if (!property || !t.isObjectProperty(property) || !t.isExpression(property.value)) {
    return { authMode: 'inherit', authProfileIdentity: null }
  }

  const value = unwrapExpression(property.value)
  if (t.isStringLiteral(value)) {
    if (value.value === 'inherit' || value.value === 'none') {
      return { authMode: value.value, authProfileIdentity: null }
    }
    diagnostics.push(diagnostic(
      'error',
      'stream-transport-auth',
      'transport.auth должен быть \'inherit\', \'none\' или { mode: \'profile\', profile: \'...\' }.',
      'transport.auth',
      value,
    ))
    return { authMode: 'inherit', authProfileIdentity: null }
  }

  if (t.isObjectExpression(value)) {
    const config = readObject(value)
    if (config.mode === 'inherit' || config.mode === 'none') {
      return { authMode: config.mode, authProfileIdentity: null }
    }
    if (config.mode === 'profile') {
      const profile = typeof config.profile === 'string' ? config.profile.trim() : ''
      if (profile) {
        return { authMode: 'profile', authProfileIdentity: profile }
      }
      diagnostics.push(diagnostic(
        'error',
        'stream-transport-auth-profile',
        'transport.auth.profile обязателен для mode: \'profile\'.',
        'transport.auth.profile',
        value,
      ))
      return { authMode: 'profile', authProfileIdentity: null }
    }
  }

  diagnostics.push(diagnostic(
    'error',
    'stream-transport-auth',
    'transport.auth должен быть \'inherit\', \'none\' или { mode: \'profile\', profile: \'...\' }.',
    'transport.auth',
    value,
  ))
  return { authMode: 'inherit', authProfileIdentity: null }
}

// Принимает только JSON literals и не исполняет authored expressions.
function readJsonValue(node: t.Node): StreamJsonValue | undefined {
  if (t.isStringLiteral(node) || t.isBooleanLiteral(node)) {
    return node.value
  }
  if (t.isNullLiteral(node)) {
    return null
  }
  if (t.isNumericLiteral(node)) {
    return Number.isFinite(node.value) ? node.value : undefined
  }
  if (t.isUnaryExpression(node) && node.operator === '-' && t.isNumericLiteral(node.argument)) {
    return Number.isFinite(node.argument.value) ? -node.argument.value : undefined
  }
  if (t.isArrayExpression(node)) {
    const values: StreamJsonValue[] = []
    for (const element of node.elements) {
      const value = element ? readJsonValue(element) : undefined
      if (value === undefined) {
        return undefined
      }
      values.push(value)
    }
    return values
  }
  if (t.isObjectExpression(node)) {
    const entries: Array<[string, StreamJsonValue]> = []
    for (const property of node.properties) {
      if (!t.isObjectProperty(property) || property.computed || property.shorthand) {
        return undefined
      }
      const key = propertyName(property.key)
      const value = readJsonValue(property.value)
      if (key === null || value === undefined) {
        return undefined
      }
      entries.push([key, value])
    }
    return Object.fromEntries(entries)
  }
  return undefined
}

function readObject(node: t.ObjectExpression): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      continue
    }
    const key = propertyName(property.key)
    const value = unwrapExpression(property.value)
    if (!key) {
      continue
    }
    if (t.isStringLiteral(value) || t.isBooleanLiteral(value) || t.isNumericLiteral(value)) {
      out[key] = value.value
    }
  }
  return out
}

// Читает строковое значение авторинга и нормализует env('NAME') в существующий
// token переменной workspace, используемый runtime-артефактами.
function readEnvironmentStringProperty(
  node: t.ObjectExpression,
  key: string,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): string {
  const property = node.properties.find(item =>
    t.isObjectProperty(item)
    && !item.computed
    && propertyName(item.key) === key,
  )
  if (!property || !t.isObjectProperty(property) || !t.isExpression(property.value)) {
    return ''
  }

  const value = unwrapExpression(property.value)
  if (t.isStringLiteral(value)) {
    return value.value.trim()
  }

  if (
    t.isCallExpression(value)
    && (
      t.isIdentifier(value.callee, { name: 'env' })
      || t.isIdentifier(value.callee, { name: 'endgeVar' })
    )
  ) {
    const name = readStringArgument(value, 0)?.trim() ?? ''
    if (!name || value.arguments.length !== 1) {
      diagnostics.push(diagnostic(
        'error',
        'stream-transport-env',
        'env(...) принимает ровно одно непустое строковое имя переменной.',
        sourcePath,
        value,
      ))
      return ''
    }
    return `{${name}}`
  }

  diagnostics.push(diagnostic(
    'error',
    'stream-transport-url-expression',
    'transport.url поддерживает строку или env(\'VARIABLE_NAME\').',
    sourcePath,
    value,
  ))
  return ''
}

function findDefinition(ast: t.File, name: string): t.CallExpression | null {
  for (const statement of ast.program.body) {
    if (!t.isExpressionStatement(statement)) {
      continue
    }
    const expression = unwrapExpression(statement.expression)
    if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name })) {
      return expression
    }
  }
  return null
}
