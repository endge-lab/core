import type { ProgramDiagnostic, QueryProgramOutput } from '@/domain/types/program/program.types'
import type { ResponseOutputTransform } from '@/domain/types/source/response-output.types'
import type { DataViewRef } from '@/domain/types/source/data-view-source.types'
import type { VocabMockReference, VocabPayloadProvider, VocabSourceCompileResult, VocabSourceDocument } from '@/domain/types/source/vocab-source.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import { compileProgramMetadataProperty } from '@/model/services/source-engine/compilers/source-metadata-compile'
import { readSourceModelReference } from '@/model/services/source-engine/compilers/source-model-reference-compile'

type Diagnostic = Omit<ProgramDiagnostic, 'entityRef'>

export function compileVocabSource(source: string): VocabSourceCompileResult {
  const diagnostics: Diagnostic[] = []
  try {
    const ast = parseTS(source, { sourceType: 'module', plugins: ['typescript'] })
    const call = findDefineCall(ast)
    const raw = call?.arguments[0]
    const definition = raw && t.isExpression(raw) ? unwrap(raw) : null
    if (!call || !t.isObjectExpression(definition)) {
      diagnostics.push(diagnostic('error', 'vocab-source-define-missing', 'Vocab source должен содержать defineVocab({...}).'))
      return { ast, document: null, artifact: null, metadata: {}, diagnostics }
    }

    const providerNode = propertyValue(definition, 'provider')
    const mockNode = propertyValue(definition, 'mock')
    const outputsNode = propertyValue(definition, 'outputs')
    const provider = providerNode ? readProvider(providerNode, diagnostics) : null
    const mock = mockNode ? readMock(mockNode, diagnostics) : null
    const outputs = outputsNode && t.isObjectExpression(unwrap(outputsNode))
      ? readOutputs(unwrap(outputsNode) as t.ObjectExpression, source, diagnostics)
      : []
    if (!outputsNode || !t.isObjectExpression(unwrap(outputsNode)))
      diagnostics.push(diagnostic('error', 'vocab-source-outputs-required', 'defineVocab.outputs должен быть объектом.', 'outputs', outputsNode ?? undefined))
    if (!outputs.some(output => output.key === 'items'))
      diagnostics.push(diagnostic('error', 'vocab-source-items-required', 'Vocab должен объявлять outputs.items.', 'outputs.items', outputsNode ?? undefined))

    const document: VocabSourceDocument = { sourceVersion: 1, provider, mock, outputs }
    const hasErrors = diagnostics.some(item => item.severity === 'error')
    return {
      ast,
      document: hasErrors ? null : document,
      artifact: hasErrors ? null : { ...document, ast, sourceDocument: document },
      metadata: compileProgramMetadataProperty(definition, diagnostics),
      diagnostics,
    }
  }
  catch (error) {
    diagnostics.push(diagnostic('error', 'vocab-source-parse-error', `Не удалось распарсить Vocab source: ${error instanceof Error ? error.message : String(error)}`))
    return { ast: null, document: null, artifact: null, metadata: {}, diagnostics }
  }
}

function findDefineCall(ast: t.File): t.CallExpression | null {
  for (const statement of ast.program.body) {
    if (!t.isExpressionStatement(statement)) continue
    const value = unwrap(statement.expression)
    if (t.isCallExpression(value) && t.isIdentifier(value.callee, { name: 'defineVocab' }))
      return value
  }
  return null
}

function readProvider(node: t.Expression, diagnostics: Diagnostic[]): VocabPayloadProvider | null {
  const value = unwrap(node)
  if (!t.isCallExpression(value) || !t.isIdentifier(value.callee, { name: 'payload' })) {
    diagnostics.push(diagnostic('error', 'vocab-source-provider-unsupported', 'provider v1 поддерживает только payload({...}).', 'provider', value))
    return null
  }
  const raw = value.arguments[0]
  const definition = raw && t.isExpression(raw) ? unwrap(raw) : null
  if (!t.isObjectExpression(definition)) {
    diagnostics.push(diagnostic('error', 'vocab-source-provider-shape', 'payload(...) требует объект настроек.', 'provider', value))
    return null
  }

  const baseUrlNode = propertyValue(definition, 'baseUrl')
  const collectionNode = propertyValue(definition, 'collection')
  const baseUrl = readBaseUrl(baseUrlNode, diagnostics)
  const collection = staticString(collectionNode)
  if (!collection)
    diagnostics.push(diagnostic('error', 'vocab-source-provider-collection', 'payload.collection должен быть непустой строкой.', 'provider.collection', collectionNode ?? definition))
  const authNode = propertyValue(definition, 'auth')
  const auth = readAuth(authNode, diagnostics)
  return { kind: 'payload', baseUrl, collection, auth }
}

function readBaseUrl(node: t.Expression | null, diagnostics: Diagnostic[]): VocabPayloadProvider['baseUrl'] {
  const direct = staticString(node)
  if (direct !== '')
    return direct
  const value = node ? unwrap(node) : null
  if (t.isCallExpression(value) && t.isIdentifier(value.callee, { name: 'env' })) {
    const name = staticString(value.arguments[0] && t.isExpression(value.arguments[0]) ? value.arguments[0] : null)
    if (name)
      return { kind: 'env', name }
  }
  diagnostics.push(diagnostic('error', 'vocab-source-provider-base-url', 'payload.baseUrl должен быть строкой или env("NAME").', 'provider.baseUrl', node ?? undefined))
  return ''
}

function readAuth(node: t.Expression | null, diagnostics: Diagnostic[]): VocabPayloadProvider['auth'] {
  if (!node)
    return { mode: 'inherit' }
  const value = unwrap(node)
  if (!t.isObjectExpression(value)) {
    diagnostics.push(diagnostic('error', 'vocab-source-provider-auth', 'payload.auth должен быть объектом.', 'provider.auth', value))
    return { mode: 'inherit' }
  }
  const mode = staticString(propertyValue(value, 'mode')) || 'inherit'
  if (mode === 'none' || mode === 'inherit')
    return { mode }
  if (mode === 'profile') {
    const profile = staticString(propertyValue(value, 'profile'))
    if (!profile)
      diagnostics.push(diagnostic('error', 'vocab-source-provider-auth-profile', 'auth.profile обязателен для mode="profile".', 'provider.auth.profile', value))
    return { mode: 'profile', profile }
  }
  diagnostics.push(diagnostic('error', 'vocab-source-provider-auth-mode', `Auth mode "${mode}" не поддерживается.`, 'provider.auth.mode', value))
  return { mode: 'inherit' }
}

function readMock(node: t.Expression, diagnostics: Diagnostic[]): VocabMockReference | null {
  let value = unwrap(node)
  let path: string | null = null
  if (t.isCallExpression(value) && t.isMemberExpression(value.callee) && !value.callee.computed && t.isIdentifier(value.callee.property, { name: 'path' })) {
    path = staticString(value.arguments[0] && t.isExpression(value.arguments[0]) ? value.arguments[0] : null)
    value = t.isExpression(value.callee.object) ? unwrap(value.callee.object) : value
    if (!path || !isDotPath(path))
      diagnostics.push(diagnostic('error', 'vocab-source-mock-path', 'mock.path должен использовать dot-нотацию, например "lookups.airlines".', 'mock.path', node))
  }
  if (!t.isCallExpression(value) || !t.isIdentifier(value.callee, { name: 'mock' })) {
    diagnostics.push(diagnostic('error', 'vocab-source-mock-shape', 'mock должен быть mock("identity") с необязательным .path("a.b").', 'mock', node))
    return null
  }
  const identity = staticString(value.arguments[0] && t.isExpression(value.arguments[0]) ? value.arguments[0] : null)
  if (!identity) {
    diagnostics.push(diagnostic('error', 'vocab-source-mock-identity', 'mock identity должен быть непустой строкой.', 'mock', node))
    return null
  }
  return { identity, path }
}

function readOutputs(node: t.ObjectExpression, source: string, diagnostics: Diagnostic[]): QueryProgramOutput[] {
  const outputs: QueryProgramOutput[] = []
  const declared = new Set<string>()
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      diagnostics.push(diagnostic('error', 'vocab-source-output-property', 'outputs поддерживает обычные object properties.', 'outputs', property))
      continue
    }
    const key = propertyName(property.key)
    if (!key || declared.has(key)) {
      diagnostics.push(diagnostic('error', 'vocab-source-output-duplicate', `Output "${key}" объявлен повторно.`, `outputs.${key}`, property))
      continue
    }
    const output = readOutput(key, unwrap(property.value), source, diagnostics)
    if (!output) continue
    if (output.source.type === 'output' && !declared.has(output.source.key))
      diagnostics.push(diagnostic('error', 'vocab-source-output-forward-reference', `Output "${output.source.key}" должен быть объявлен выше.`, `outputs.${key}.from`, property))
    outputs.push(output)
    declared.add(key)
  }
  return outputs
}

function readOutput(key: string, node: t.Expression, source: string, diagnostics: Diagnostic[]): QueryProgramOutput | null {
  const calls = memberChain(node)
  if (!calls) {
    diagnostics.push(diagnostic('error', 'vocab-source-output-shape', `Output "${key}" должен использовать output().from(...).`, `outputs.${key}`, node))
    return null
  }
  let outputSource: QueryProgramOutput['source'] | null = null
  const dataViews: DataViewRef[] = []
  const transforms: ResponseOutputTransform[] = []
  for (const call of calls) {
    if (call.name === 'from') {
      const raw = call.args[0]
      if (t.isStringLiteral(raw))
        outputSource = { type: 'output', key: raw.value }
      else if (t.isCallExpression(raw) && t.isIdentifier(raw.callee, { name: 'response' }) && raw.arguments.length === 0)
        outputSource = { type: 'response', path: null }
      else
        diagnostics.push(diagnostic('error', 'vocab-source-output-from', '.from(...) поддерживает response() или ключ предыдущего output.', `outputs.${key}.from`, raw && t.isNode(raw) ? raw : node))
      continue
    }
    if (call.name === 'dataView') {
      const ref = readDataView(call.args[0], source, diagnostics, `outputs.${key}.dataView`)
      if (ref) {
        dataViews.push(ref)
        transforms.push({ kind: 'data-view', ref })
      }
      continue
    }
    if (call.name === 'convert') {
      const transform = readConverter(call.args, diagnostics, `outputs.${key}.convert`)
      if (transform) transforms.push(transform)
      continue
    }
    diagnostics.push(diagnostic('error', 'vocab-source-output-method', `output().${call.name}(...) не поддерживается.`, `outputs.${key}`, node))
  }
  if (!outputSource) {
    diagnostics.push(diagnostic('error', 'vocab-source-output-from-required', `Output "${key}" должен содержать .from(...).`, `outputs.${key}`, node))
    return null
  }
  return {
    key,
    source: outputSource,
    transforms,
    dataViews,
    contract: null,
    materialization: outputSource.type === 'response' && transforms.length === 0
      ? { kind: 'source' }
      : { kind: 'derived', strategy: { kind: 'full' } },
  }
}

function readDataView(node: t.CallExpression['arguments'][number] | undefined, source: string, diagnostics: Diagnostic[], sourcePath: string): DataViewRef | null {
  if (!node || !t.isExpression(node)) {
    diagnostics.push(diagnostic('error', 'vocab-source-output-dataview', '.dataView(...) требует DataView.', sourcePath))
    return null
  }
  const ref = readSourceModelReference(node, source, { referenceCall: 'dataView', defineCall: 'defineDataView' })
  if (ref?.kind === 'external') return ref
  if (ref?.kind === 'inline') return { kind: 'inline', source: ref.source }
  diagnostics.push(diagnostic('error', 'vocab-source-output-dataview', '.dataView(...) поддерживает identity или defineDataView({...}).', sourcePath, node))
  return null
}

function readConverter(args: t.CallExpression['arguments'], diagnostics: Diagnostic[], sourcePath: string): Extract<ResponseOutputTransform, { kind: 'converter' }> | null {
  const raw = args[0]
  const identity = t.isStringLiteral(raw)
    ? raw.value.trim()
    : t.isCallExpression(raw) && t.isIdentifier(raw.callee, { name: 'converter' }) && t.isStringLiteral(raw.arguments[0])
      ? raw.arguments[0].value.trim()
      : ''
  if (!identity) {
    diagnostics.push(diagnostic('error', 'vocab-source-output-converter', '.convert(...) требует identity Converter.', sourcePath, raw && t.isNode(raw) ? raw : undefined))
    return null
  }
  const optionsNode = args[1]
  if (!optionsNode)
    return { kind: 'converter', identity }
  if (!t.isExpression(optionsNode)) {
    diagnostics.push(diagnostic('error', 'vocab-source-output-converter-options', 'Converter options должны быть объектом.', sourcePath))
    return null
  }
  const options = staticValue(optionsNode)
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    diagnostics.push(diagnostic('error', 'vocab-source-output-converter-options', 'Converter options должны быть статическим объектом.', sourcePath, optionsNode))
    return null
  }
  return { kind: 'converter', identity, options: options as Record<string, unknown> }
}

function memberChain(node: t.Expression): Array<{ name: string, args: t.CallExpression['arguments'] }> | null {
  let current = unwrap(node)
  const result: Array<{ name: string, args: t.CallExpression['arguments'] }> = []
  while (t.isCallExpression(current) && t.isMemberExpression(current.callee) && !current.callee.computed && t.isIdentifier(current.callee.property)) {
    result.unshift({ name: current.callee.property.name, args: current.arguments })
    if (!t.isExpression(current.callee.object)) return null
    current = unwrap(current.callee.object)
  }
  return t.isCallExpression(current) && t.isIdentifier(current.callee, { name: 'output' }) ? result : null
}

function staticValue(node: t.Expression): unknown {
  const value = unwrap(node)
  if (t.isStringLiteral(value) || t.isNumericLiteral(value) || t.isBooleanLiteral(value)) return value.value
  if (t.isNullLiteral(value)) return null
  if (t.isArrayExpression(value)) return value.elements.map(item => item && t.isExpression(item) ? staticValue(item) : null)
  if (t.isObjectExpression(value)) {
    const result: Record<string, unknown> = {}
    for (const property of value.properties) {
      if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) return undefined
      const key = propertyName(property.key)
      if (!key) return undefined
      result[key] = staticValue(property.value)
    }
    return result
  }
  return undefined
}

function staticString(node: t.Expression | null | undefined): string {
  const value = node ? unwrap(node) : null
  return t.isStringLiteral(value) ? value.value.trim() : ''
}

function propertyValue(node: t.ObjectExpression, name: string): t.Expression | null {
  const property = node.properties.find(item => t.isObjectProperty(item) && !item.computed && propertyName(item.key) === name)
  return property && t.isObjectProperty(property) && t.isExpression(property.value) ? property.value : null
}

function propertyName(node: t.Expression | t.PrivateName): string | null {
  if (t.isIdentifier(node)) return node.name
  if (t.isStringLiteral(node) || t.isNumericLiteral(node)) return String(node.value)
  return null
}

function unwrap<T extends t.Expression>(node: T): t.Expression {
  let value: t.Expression = node
  while (t.isTSAsExpression(value) || t.isTSTypeAssertion(value) || t.isTSNonNullExpression(value) || t.isParenthesizedExpression(value))
    value = value.expression
  return value
}

function isDotPath(value: string): boolean {
  return value.split('.').every(segment => /^(?:[A-Za-z_$][\w$]*|\d+)$/.test(segment))
}

function diagnostic(severity: ProgramDiagnostic['severity'], code: string, message: string, sourcePath?: string, node?: t.Node): Diagnostic {
  return {
    severity,
    code,
    message,
    ...(sourcePath ? { sourcePath } : {}),
    ...(node?.start != null ? { start: node.start } : {}),
    ...(node?.end != null ? { end: node.end } : {}),
  }
}
