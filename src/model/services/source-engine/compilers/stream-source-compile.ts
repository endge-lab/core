import type { ProgramDiagnostic } from '@/domain/types/program/program.types'
import type {
  StreamEventDescriptor,
  StreamSourceCompileResult,
  StreamTransportDescriptor,
} from '@/domain/types/source/stream-source.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import { diagnostic, propertyName, readStringArgument, unwrapExpression } from '@/model/services/source-engine/compilers/source-expression-compile'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

/** Compiles declarative Stream source without opening a transport. */
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
        const config = readObject(value.arguments[0])
        const url = typeof config.url === 'string' ? config.url.trim() : ''
        if (!url) {
          diagnostics.push(diagnostic('error', 'stream-transport-url', 'SSE transport требует непустой url.', 'transport.url', value))
          continue
        }
        transport = { kind: 'sse', url, withCredentials: config.withCredentials === true }
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

    if (!transport)
      diagnostics.push(diagnostic('error', 'stream-transport-missing', 'defineStream требует transport.', 'transport', definition))
    if (!events.length)
      diagnostics.push(diagnostic('error', 'stream-events-empty', 'defineStream требует хотя бы одно событие.', 'events', definition))

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
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value))
      continue
    const sourceEvent = propertyName(property.key)
    const call = unwrapExpression(property.value)
    if (!sourceEvent || !t.isCallExpression(call) || !t.isIdentifier(call.callee, { name: 'event' })) {
      diagnostics.push(diagnostic('error', 'stream-event-shape', 'Stream event должен иметь вид sourceEvent: event(type[, payloadPath]).', 'events', property))
      continue
    }
    const type = readStringArgument(call, 0)?.trim() ?? ''
    const payloadPath = readStringArgument(call, 1)?.trim() ?? null
    if (!type) {
      diagnostics.push(diagnostic('error', 'stream-event-type', `Событие "${sourceEvent}" требует канонический type.`, `events.${sourceEvent}`, call))
      continue
    }
    if (types.has(type))
      diagnostics.push(diagnostic('warning', 'stream-event-type-duplicate', `Несколько transport events нормализуются в "${type}".`, `events.${sourceEvent}`, call))
    types.add(type)
    events.push({ sourceEvent, type, payloadPath })
  }
  return events
}

function readObject(node: t.ObjectExpression): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value))
      continue
    const key = propertyName(property.key)
    const value = unwrapExpression(property.value)
    if (!key)
      continue
    if (t.isStringLiteral(value) || t.isBooleanLiteral(value) || t.isNumericLiteral(value))
      out[key] = value.value
  }
  return out
}

function findDefinition(ast: t.File, name: string): t.CallExpression | null {
  for (const statement of ast.program.body) {
    if (!t.isExpressionStatement(statement))
      continue
    const expression = unwrapExpression(statement.expression)
    if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name }))
      return expression
  }
  return null
}
