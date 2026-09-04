import type { ProgramDiagnostic } from '@/modules/program/domain/types/program.types'
import type {
  StreamEventDescriptor,
  StreamSourceCompileResult,
  StreamTransportDescriptor,
} from '@/modules/source/domain/types/stream-source.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import { diagnostic, propertyName, readStringArgument, unwrapExpression } from '@/modules/source/services/compilers/source-expression-compile'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

/** Компилирует декларативный source Stream без открытия транспорта. */
export function compileStreamSource(source: string, sourceVersion = 1): StreamSourceCompileResult {
  const diagnostics: DiagnosticDraft[] = []
  if (!String(source ?? '').trim()) {
    diagnostics.push(diagnostic('error', 'stream-source-empty', 'Stream source пуст.'))
    return { ast: null, document: null, artifact: null, diagnostics }
  }

  try {
    const ast = parseTS(source, { sourceType: 'module', plugins: ['typescript'] })
    const call = findDefinition(ast, 'defineStream')
    const definition = call?.arguments[0]
    if (!call || !definition || !t.isObjectExpression(definition)) {
      diagnostics.push(diagnostic('error', 'stream-source-definition', 'Stream source должен содержать defineStream({...}).'))
      return { ast, document: null, artifact: null, diagnostics }
    }

    let transport: StreamTransportDescriptor | null = null
    let events: StreamEventDescriptor[] = []
    for (const property of definition.properties) {
      if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
        diagnostics.push(diagnostic('error', 'stream-source-property', 'defineStream допускает только обычные properties.', 'defineStream', property))
        continue
      }
      const name = propertyName(property.key)
      const value = unwrapExpression(property.value)
      if (name === 'transport') {
        if (!t.isCallExpression(value) || !t.isIdentifier(value.callee, { name: 'sse' }) || !t.isObjectExpression(value.arguments[0])) {
          diagnostics.push(diagnostic('error', 'stream-transport-shape', 'transport должен иметь вид sse({ url, withCredentials? }).', 'transport', value))
          continue
        }
        const transportDefinition = value.arguments[0]
        const config = readObject(transportDefinition)
        const url = readEnvironmentStringProperty(transportDefinition, 'url', diagnostics, 'transport.url')
        if (!url) {
          if (!diagnostics.some(item => item.sourcePath === 'transport.url')) {
            diagnostics.push(diagnostic('error', 'stream-transport-url', 'SSE transport требует непустой url или env(...).', 'transport.url', value))
          }
          continue
        }
        const auth = readTransportAuth(transportDefinition, diagnostics)
        transport = {
          kind: 'sse',
          url,
          withCredentials: config.withCredentials === true,
          ...auth,
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

    const document = transport ? { transport, events } : null
    const hasErrors = diagnostics.some(item => item.severity === 'error')
    return {
      ast,
      document: hasErrors ? null : document,
      artifact: hasErrors || !document ? null : { type: 'stream', sourceVersion, ...document },
      diagnostics,
    }
  }
  catch (error: any) {
    diagnostics.push(diagnostic('error', 'stream-source-parse-error', `Не удалось распарсить Stream source: ${error?.message ?? error}`))
    return { ast: null, document: null, artifact: null, diagnostics }
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
    if (first && t.isObjectExpression(first)) {
      const config = readObject(first)
      typePath = typeof config.typeFrom === 'string' ? config.typeFrom.trim() : null
      payloadPath = typeof config.payloadFrom === 'string' ? config.payloadFrom.trim() || null : null
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
    events.push({ sourceEvent, type, typePath, payloadPath })
  }
  return events
}

function readTransportAuth(
  node: t.ObjectExpression,
  diagnostics: DiagnosticDraft[],
): Pick<StreamTransportDescriptor, 'authMode' | 'authProfileIdentity'> {
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

/**
 * Читает строковое значение авторинга и нормализует env('NAME') в существующий
 * token переменной workspace, используемый runtime-артефактами.
 */
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
