import { parse } from '@babel/parser'
import * as t from '@babel/types'

import type {
  ComputationContractField,
  ComputationProgramNode,
  ComputationProgramPayload,
  ComputationSourceDocument,
  ComputationSourceNode,
} from '@/domain/types/computation'
import type { ProgramDiagnostic } from '@/domain/types/program/program.types'
import type { SourceExpressionIR } from '@/domain/types/source/source-expression.types'
import {
  compileSourceExpression,
  diagnostic,
  propertyName,
  unwrapExpression,
} from '@/model/services/source-engine/compilers/source-expression-compile'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

interface ExternalComputationCompileContext {
  sourceNodes: ComputationSourceNode[]
  reservedNames: Set<string>
  nextCallId: number
}

export interface ComputationCompileInput {
  source: string
  input: ComputationContractField | null
  output: ComputationContractField | null
}

export interface ComputationCompileResult {
  payload: ComputationProgramPayload
  diagnostics: DiagnosticDraft[]
}

/** Compiles defineComputation source into a deterministic output graph. */
export function compileComputation(input: ComputationCompileInput): ComputationCompileResult {
  const diagnostics: DiagnosticDraft[] = []
  const payload: ComputationProgramPayload = {
    input: input.input,
    output: input.output,
    sourceDocument: null,
    nodes: [],
    result: null,
    execution: 'sync',
  }

  if (!input.source.trim()) {
    diagnostics.push(diagnostic('error', 'computation-source-empty', 'Computation source пуст.', 'source'))
    return { payload, diagnostics }
  }

  let file: t.File
  try {
    file = parse(input.source, { sourceType: 'module', plugins: ['typescript'] })
  }
  catch (error: any) {
    diagnostics.push({
      severity: 'error',
      code: 'computation-source-parse-error',
      message: `Не удалось разобрать computation source: ${error?.message ?? error}`,
      sourcePath: 'source',
      start: typeof error?.pos === 'number' ? error.pos : undefined,
    })
    return { payload, diagnostics }
  }

  const calls: t.CallExpression[] = []
  for (const statement of file.program.body) {
    if (t.isImportDeclaration(statement)) {
      diagnostics.push(diagnostic('error', 'computation-import-unsupported', 'Imports запрещены в computation source.', 'source', statement))
      continue
    }
    if (t.isExportDefaultDeclaration(statement)) {
      diagnostics.push(diagnostic(
        'error',
        'computation-legacy-source-unsupported',
        'Legacy `export default function compute` больше не поддерживается. Используйте defineComputation({...}).',
        'source',
        statement,
      ))
      continue
    }
    if (t.isTSInterfaceDeclaration(statement) || t.isTSTypeAliasDeclaration(statement))
      continue
    if (t.isExpressionStatement(statement)) {
      const expression = unwrapExpression(statement.expression)
      if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'defineComputation' })) {
        calls.push(expression)
        continue
      }
    }
    if (!t.isEmptyStatement(statement))
      diagnostics.push(diagnostic('error', 'computation-top-level-unsupported', 'Разрешены только type declarations и один defineComputation({...}).', 'source', statement))
  }

  if (calls.length !== 1) {
    diagnostics.push(diagnostic(
      'error',
      'computation-define-required',
      'Computation source должен содержать ровно один top-level defineComputation({...}).',
      'source',
      calls[1] ?? calls[0],
    ))
    return { payload, diagnostics }
  }

  const definition = calls[0]!.arguments[0]
  if (!definition || !t.isObjectExpression(definition)) {
    diagnostics.push(diagnostic('error', 'computation-definition-object', 'defineComputation принимает object literal.', 'source', calls[0]))
    return { payload, diagnostics }
  }

  let outputsNode: t.ObjectExpression | null = null
  let resultNode: t.Expression | null = null
  for (const property of definition.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      diagnostics.push(diagnostic('error', 'computation-definition-property', 'defineComputation допускает только обычные properties.', 'source', property))
      continue
    }
    const name = propertyName(property.key)
    if (name === 'outputs') {
      const value = unwrapExpression(property.value)
      if (t.isObjectExpression(value)) outputsNode = value
      else diagnostics.push(diagnostic('error', 'computation-outputs-object', 'outputs должен быть object literal.', 'outputs', value))
    }
    else if (name === 'result') resultNode = property.value
    else diagnostics.push(diagnostic('error', 'computation-definition-property-unsupported', `Свойство "${name ?? ''}" не поддерживается.`, 'source', property))
  }

  if (!outputsNode || outputsNode.properties.length === 0)
    diagnostics.push(diagnostic('error', 'computation-outputs-required', 'defineComputation требует непустой outputs object.', 'outputs', outputsNode ?? definition))
  if (!resultNode)
    diagnostics.push(diagnostic('error', 'computation-result-required', 'defineComputation требует result expression.', 'result', definition))
  if (!outputsNode || !resultNode)
    return { payload, diagnostics }

  const sourceNodes: ComputationSourceNode[] = []
  const reservedNames = new Set(outputsNode.properties.flatMap((property) => {
    if (!t.isObjectProperty(property) || property.computed)
      return []
    const name = propertyName(property.key)
    return name ? [name] : []
  }))
  const externalContext: ExternalComputationCompileContext = {
    sourceNodes,
    reservedNames,
    nextCallId: 0,
  }
  const declaredNames = new Set<string>()
  for (const property of outputsNode.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      diagnostics.push(diagnostic('error', 'computation-output-property', 'outputs допускает только обычные properties.', 'outputs', property))
      continue
    }
    const name = propertyName(property.key)
    if (!name)
      continue
    if (declaredNames.has(name)) {
      diagnostics.push(diagnostic('error', 'computation-output-duplicate', `Output "${name}" объявлен повторно.`, `outputs.${name}`, property))
      continue
    }
    declaredNames.add(name)
    const value = unwrapExpression(property.value)
    const sourceRange = range(property)
    if (isTypescriptCall(value)) {
      const node = compileTypescriptNode(name, value, input.source, diagnostics, externalContext)
      if (node) sourceNodes.push({ ...node, sourceRange })
      continue
    }
    const expression = compileComputationExpression(value, diagnostics, `outputs.${name}`, externalContext)
    if (expression)
      sourceNodes.push({ kind: 'expression', name, expression, sourceRange })
  }

  const result = compileComputationExpression(resultNode, diagnostics, 'result', externalContext)
  if (!result)
    return { payload, diagnostics }

  const known = new Set(sourceNodes.map(node => node.name))
  const programNodes: ComputationProgramNode[] = sourceNodes.map((node) => {
    const expressions = node.kind === 'expression'
      ? [node.expression]
      : node.kind === 'typescript'
        ? Object.values(node.inputs)
        : [node.input]
    const dependencies = unique(expressions.flatMap(collectOutputReferences))
    for (const dependency of dependencies) {
      if (!known.has(dependency)) {
        diagnostics.push({
          ...diagnostic('error', 'computation-output-unknown', `Output "${node.name}" ссылается на неизвестный output "${dependency}".`, `outputs.${node.name}`),
          start: node.sourceRange?.start,
          end: node.sourceRange?.end,
        })
      }
    }
    if (node.kind === 'expression')
      return { kind: 'expression', name: node.name, dependencies, expression: node.expression }
    if (node.kind === 'typescript') {
      return {
        kind: 'typescript',
        name: node.name,
        dependencies,
        inputs: node.inputs,
        moduleKey: hash(`${node.name}:${node.source}`),
        source: node.source,
      }
    }
    return {
      kind: 'computation',
      name: node.name,
      dependencies,
      identity: node.identity,
      input: node.input,
    }
  })
  for (const dependency of collectOutputReferences(result)) {
    if (!known.has(dependency))
      diagnostics.push(diagnostic('error', 'computation-result-output-unknown', `result ссылается на неизвестный output "${dependency}".`, 'result', resultNode))
  }

  const ordered = topologicalSort(programNodes, diagnostics, outputsNode)
  const document: ComputationSourceDocument = { outputs: sourceNodes, result }
  payload.sourceDocument = document
  payload.nodes = ordered
  payload.result = result
  payload.execution = ordered.some(node => node.kind === 'typescript' || node.kind === 'computation') ? 'async' : 'sync'
  return { payload, diagnostics }
}

function compileTypescriptNode(
  name: string,
  call: t.CallExpression,
  source: string,
  diagnostics: DiagnosticDraft[],
  externalContext: ExternalComputationCompileContext,
): Extract<ComputationSourceNode, { kind: 'typescript' }> | null {
  const definition = call.arguments[0]
  if (!definition || !t.isObjectExpression(definition)) {
    diagnostics.push(diagnostic('error', 'computation-typescript-object', 'typescript(...) принимает object literal.', `outputs.${name}`, call))
    return null
  }
  let inputsNode: t.ObjectExpression | null = null
  let computeNode: t.ObjectMethod | t.FunctionExpression | t.ArrowFunctionExpression | null = null
  for (const property of definition.properties) {
    const propertyKey = (t.isObjectProperty(property) || t.isObjectMethod(property)) ? propertyName(property.key) : null
    if (propertyKey === 'inputs' && t.isObjectProperty(property) && t.isExpression(property.value)) {
      const value = unwrapExpression(property.value)
      if (t.isObjectExpression(value)) inputsNode = value
      else diagnostics.push(diagnostic('error', 'computation-typescript-inputs-object', 'typescript.inputs должен быть object literal.', `outputs.${name}.inputs`, value))
      continue
    }
    if (propertyKey === 'compute') {
      if (t.isObjectMethod(property)) computeNode = property
      else if (t.isObjectProperty(property) && (t.isFunctionExpression(property.value) || t.isArrowFunctionExpression(property.value))) computeNode = property.value
      else diagnostics.push(diagnostic('error', 'computation-typescript-compute-function', 'typescript.compute должен быть function или method.', `outputs.${name}.compute`, property))
      continue
    }
    diagnostics.push(diagnostic('error', 'computation-typescript-property', `Свойство "${propertyKey ?? ''}" не поддерживается в typescript node.`, `outputs.${name}`, property))
  }
  if (!inputsNode)
    diagnostics.push(diagnostic('error', 'computation-typescript-inputs-required', 'typescript node требует inputs object.', `outputs.${name}.inputs`, definition))
  if (!computeNode)
    diagnostics.push(diagnostic('error', 'computation-typescript-compute-required', 'typescript node требует compute(inputs, api).', `outputs.${name}.compute`, definition))
  if (!inputsNode || !computeNode)
    return null
  if (computeNode.async || computeNode.generator)
    diagnostics.push(diagnostic('error', 'computation-typescript-async', 'typescript.compute должен быть синхронным и не generator.', `outputs.${name}.compute`, computeNode))
  if (computeNode.params.length < 1 || computeNode.params.length > 2)
    diagnostics.push(diagnostic('error', 'computation-typescript-parameters', 'typescript.compute принимает inputs и optional api.', `outputs.${name}.compute`, computeNode))

  validateSandboxBody(computeNode, diagnostics, `outputs.${name}.compute`)
  const inputs: Record<string, SourceExpressionIR> = {}
  const inputNames = new Set<string>()
  for (const property of inputsNode.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      diagnostics.push(diagnostic('error', 'computation-typescript-input-property', 'typescript.inputs допускает только обычные properties.', `outputs.${name}.inputs`, property))
      continue
    }
    const inputName = propertyName(property.key)
    if (!inputName)
      continue
    if (inputNames.has(inputName)) {
      diagnostics.push(diagnostic('error', 'computation-typescript-input-duplicate', `Input "${inputName}" объявлен повторно.`, `outputs.${name}.inputs.${inputName}`, property))
      continue
    }
    inputNames.add(inputName)
    const expression = compileComputationExpression(
      property.value,
      diagnostics,
      `outputs.${name}.inputs.${inputName}`,
      externalContext,
    )
    if (expression) inputs[inputName] = expression
  }

  return {
    kind: 'typescript',
    name,
    inputs,
    source: functionSource(computeNode, source),
  }
}

function compileComputationExpression(
  raw: t.Expression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
  externalContext: ExternalComputationCompileContext,
): SourceExpressionIR | null {
  const rewritten = rewriteComputationReads(raw, diagnostics, sourcePath)
  const lifted = liftExternalComputationCalls(rewritten, diagnostics, sourcePath, externalContext)
  return compileSourceExpression(lifted, diagnostics, sourcePath)
}

function rewriteComputationReads(raw: t.Expression, diagnostics: DiagnosticDraft[], sourcePath: string): t.Expression {
  const node = t.cloneNode(raw, true)
  walk(node, (current) => {
    if (!t.isCallExpression(current) || !t.isIdentifier(current.callee))
      return
    if (current.callee.name !== 'input' && current.callee.name !== 'output')
      return
    if (current.arguments.length > 1 || (current.arguments[0] && !t.isStringLiteral(current.arguments[0]))) {
      diagnostics.push(diagnostic('error', 'computation-read-path', `${current.callee.name}(...) принимает ${current.callee.name === 'input' ? 'optional ' : ''}строковый path.`, sourcePath, current))
      return
    }
    if (current.callee.name === 'input') {
      current.callee = t.identifier('path')
      if (current.arguments.length === 0) current.arguments = [t.stringLiteral('')]
    }
    else {
      current.callee = t.identifier('__computationOutput')
    }
  })
  return node
}

/** Поднимает nested computation(...) calls в отдельные graph nodes. */
function liftExternalComputationCalls(
  root: t.Expression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
  context: ExternalComputationCompileContext,
): t.Expression {
  const transform = (current: t.Node): t.Node => {
    const keys = (t.VISITOR_KEYS as Record<string, string[]>)[current.type] ?? []
    for (const key of keys) {
      const value = (current as any)[key]
      if (Array.isArray(value)) {
        (current as any)[key] = value.map(child => child && typeof child.type === 'string' ? transform(child) : child)
      }
      else if (value && typeof value.type === 'string') {
        (current as any)[key] = transform(value)
      }
    }

    if (!t.isCallExpression(current) || !t.isIdentifier(current.callee, { name: 'computation' }))
      return current

    const identityNode = current.arguments[0]
    const inputNode = current.arguments[1]
    if (!t.isStringLiteral(identityNode) || !identityNode.value.trim()) {
      diagnostics.push(diagnostic(
        'error',
        'computation-reference-identity',
        'computation(identity, input) требует непустой static string identity.',
        sourcePath,
        current,
      ))
      return t.identifier('undefined')
    }
    if (current.arguments.length !== 2 || !inputNode || !t.isExpression(inputNode)) {
      diagnostics.push(diagnostic(
        'error',
        'computation-reference-input',
        'computation(identity, input) требует ровно два arguments и expression input.',
        sourcePath,
        current,
      ))
      return t.identifier('undefined')
    }

    const input = compileSourceExpression(inputNode, diagnostics, `${sourcePath}.input`)
    if (!input)
      return t.identifier('undefined')

    const name = nextExternalNodeName(context)
    context.sourceNodes.push({
      kind: 'computation',
      name,
      identity: identityNode.value.trim(),
      input,
      sourceRange: range(current),
    })
    return t.callExpression(t.identifier('__computationOutput'), [t.stringLiteral(name)])
  }

  return transform(root) as t.Expression
}

function nextExternalNodeName(context: ExternalComputationCompileContext): string {
  let name = ''
  do name = `__computation_call_${context.nextCallId++}`
  while (context.reservedNames.has(name))
  context.reservedNames.add(name)
  return name
}

function validateSandboxBody(node: t.Node, diagnostics: DiagnosticDraft[], sourcePath: string): void {
  const forbidden = new Set([
    'eval', 'Function', 'Promise', 'fetch', 'XMLHttpRequest', 'WebSocket',
    'Worker', 'SharedWorker', 'setTimeout', 'setInterval', 'require', 'process',
    'Deno', 'Bun', 'globalThis', 'self', 'window', 'document', 'navigator',
  ])
  const bindings = collectBindingNames(node)
  walkWithParent(node, null, (current, parent) => {
    if (t.isAwaitExpression(current))
      diagnostics.push(diagnostic('error', 'computation-typescript-await', 'await запрещён в synchronous typescript.compute.', sourcePath, current))
    if (t.isImport(current) || t.isImportDeclaration(current))
      diagnostics.push(diagnostic('error', 'computation-typescript-import', 'Dynamic и static imports запрещены.', sourcePath, current))
    if (t.isCallExpression(current) && t.isIdentifier(current.callee, { name: 'computation' }))
      diagnostics.push(diagnostic('error', 'computation-typescript-reference', 'External computation calls разрешены только в graph expressions и typescript.inputs.', sourcePath, current))
    if (t.isIdentifier(current)
      && forbidden.has(current.name)
      && !bindings.has(current.name)
      && !isNonComputedPropertyName(current, parent))
      diagnostics.push(diagnostic('error', 'computation-typescript-global', `Global "${current.name}" запрещён в sandbox.`, sourcePath, current))
  })
}

function collectBindingNames(node: t.Node): Set<string> {
  const names = new Set<string>()
  walk(node, (current) => {
    if (t.isVariableDeclarator(current)) addPatternNames(current.id, names)
    else if (t.isFunction(current)) current.params.forEach(param => addPatternNames(param, names))
    else if ((t.isFunctionDeclaration(current) || t.isClassDeclaration(current)) && current.id) names.add(current.id.name)
    else if (t.isCatchClause(current) && current.param) addPatternNames(current.param, names)
  })
  return names
}

function addPatternNames(node: t.LVal | t.PatternLike, names: Set<string>): void {
  if (t.isIdentifier(node)) names.add(node.name)
  else if (t.isRestElement(node)) addPatternNames(node.argument, names)
  else if (t.isAssignmentPattern(node)) addPatternNames(node.left, names)
  else if (t.isArrayPattern(node)) node.elements.forEach(item => item && addPatternNames(item, names))
  else if (t.isObjectPattern(node)) {
    for (const property of node.properties) {
      if (t.isRestElement(property)) addPatternNames(property.argument, names)
      else addPatternNames(property.value as t.LVal | t.PatternLike, names)
    }
  }
}

function isNonComputedPropertyName(node: t.Identifier, parent: t.Node | null): boolean {
  if (!parent)
    return false
  if ((t.isObjectProperty(parent) || t.isObjectMethod(parent) || t.isClassMethod(parent))
    && parent.key === node
    && !parent.computed)
    return true
  return t.isMemberExpression(parent) && parent.property === node && !parent.computed
}

function functionSource(node: t.ObjectMethod | t.FunctionExpression | t.ArrowFunctionExpression, source: string): string {
  const params = node.params.map(param => source.slice(param.start ?? 0, param.end ?? 0)).join(', ')
  if (t.isBlockStatement(node.body))
    return `function(${params}) ${source.slice(node.body.start ?? 0, node.body.end ?? 0)}`
  return `function(${params}) { return (${source.slice(node.body.start ?? 0, node.body.end ?? 0)}); }`
}

function isTypescriptCall(node: t.Expression): node is t.CallExpression {
  return t.isCallExpression(node) && t.isIdentifier(node.callee, { name: 'typescript' })
}

function collectOutputReferences(expression: SourceExpressionIR): string[] {
  if (expression.type === 'read')
    return expression.source === 'computation-output' ? [expression.path] : []
  if (expression.type === 'array')
    return expression.items.flatMap(collectOutputReferences)
  if (expression.type === 'object')
    return Object.values(expression.properties).flatMap(collectOutputReferences)
  if (expression.type === 'operation')
    return expression.arguments.flatMap(collectOutputReferences)
  return []
}

function topologicalSort(nodes: ComputationProgramNode[], diagnostics: DiagnosticDraft[], sourceNode: t.Node): ComputationProgramNode[] {
  const byName = new Map(nodes.map(node => [node.name, node]))
  const pending = new Map(nodes.map(node => [node.name, new Set(node.dependencies.filter(dep => byName.has(dep)))]))
  const ordered: ComputationProgramNode[] = []
  while (pending.size) {
    const ready = nodes.filter(node => pending.has(node.name) && pending.get(node.name)!.size === 0)
    if (!ready.length) {
      diagnostics.push(diagnostic('error', 'computation-output-cycle', `Обнаружен cycle между outputs: ${[...pending.keys()].join(', ')}.`, 'outputs', sourceNode))
      return nodes
    }
    for (const node of ready) {
      ordered.push(node)
      pending.delete(node.name)
      for (const dependencies of pending.values()) dependencies.delete(node.name)
    }
  }
  return ordered
}

function walk(node: t.Node, visit: (node: t.Node) => void): void {
  visit(node)
  const keys = (t.VISITOR_KEYS as Record<string, string[]>)[node.type] ?? []
  for (const key of keys) {
    const value = (node as any)[key]
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child.type === 'string') walk(child, visit)
    }
    else if (value && typeof value.type === 'string') walk(value, visit)
  }
}

function walkWithParent(node: t.Node, parent: t.Node | null, visit: (node: t.Node, parent: t.Node | null) => void): void {
  visit(node, parent)
  const keys = (t.VISITOR_KEYS as Record<string, string[]>)[node.type] ?? []
  for (const key of keys) {
    const value = (node as any)[key]
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child.type === 'string') walkWithParent(child, node, visit)
    }
    else if (value && typeof value.type === 'string') walkWithParent(value, node, visit)
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function range(node: t.Node): { start: number, end: number } | undefined {
  return node.start != null && node.end != null ? { start: node.start, end: node.end } : undefined
}

function hash(value: string): string {
  let result = 2166136261
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(16).padStart(8, '0')
}
