import type { ActionProgramPayload } from '@/domain/types/program/action-program.types'
import type { ProgramDependency, ProgramDiagnostic } from '@/domain/types/program/program.types'

import type { ActionTargetSelector } from '@/domain/types/runtime/action.types'
import type {
  ActionSourceBlock,
  ActionSourceDocument,
  ActionSourceStep,
  ActionSourceTypescriptStep,
} from '@/domain/types/source/action-source.types'
import type { SourceExpressionIR } from '@/domain/types/source/source-expression.types'
import { parse } from '@babel/parser'
import * as t from '@babel/types'
import { functionSource, validateSandboxBody } from '@/model/services/compiler/computation/computation-compile'
import {
  compileSourceExpression,
  diagnostic,
  propertyName,
  unwrapExpression,
} from '@/model/services/source-engine/compilers/source-expression-compile'
import { compileSourceField } from '@/model/services/source-engine/compilers/source-field-compile'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

export interface ActionSourceCompileInput {
  source: string
  sourceVersion?: number
  target?: ActionTargetSelector[] | null
}

export interface ActionSourceCompileResult {
  payload: ActionProgramPayload
  diagnostics: DiagnosticDraft[]
  dependencies: ProgramDependency[]
}

interface BlockContext {
  source: string
  diagnostics: DiagnosticDraft[]
  dependencies: ProgramDependency[]
  inputRead: 'action' | 'operation-run' | 'operation-undo' | 'operation-redo'
}

/** Compiles one canonical defineAction source into deterministic sequential IR. */
export function compileActionSource(input: ActionSourceCompileInput): ActionSourceCompileResult {
  const diagnostics: DiagnosticDraft[] = []
  const dependencies: ProgramDependency[] = []
  const payload: ActionProgramPayload = {
    type: 'action',
    sourceVersion: Math.max(1, Number(input.sourceVersion ?? 1) || 1),
    sourceDocument: null,
    target: input.target ?? null,
  }
  if (!input.source.trim()) {
    diagnostics.push(diagnostic('error', 'action-source-empty', 'Action source пуст.', 'source'))
    return { payload, diagnostics, dependencies }
  }

  let file: t.File
  try {
    file = parse(input.source, { sourceType: 'module', plugins: ['typescript'] })
  }
  catch (error: any) {
    diagnostics.push({
      severity: 'error',
      code: 'action-source-parse-error',
      message: `Не удалось разобрать Action source: ${error?.message ?? error}`,
      sourcePath: 'source',
      start: typeof error?.pos === 'number' ? error.pos : undefined,
    })
    return { payload, diagnostics, dependencies }
  }

  const calls: t.CallExpression[] = []
  for (const statement of file.program.body) {
    if (t.isTSTypeAliasDeclaration(statement) || t.isTSInterfaceDeclaration(statement)) {
      continue
    }
    if (t.isExpressionStatement(statement)) {
      const expression = unwrapExpression(statement.expression)
      if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'defineAction' })) {
        calls.push(expression)
        continue
      }
    }
    diagnostics.push(diagnostic('error', 'action-top-level-unsupported', 'Разрешены только type declarations и один defineAction({...}).', 'source', statement))
  }
  if (calls.length !== 1) {
    diagnostics.push(diagnostic('error', 'action-define-required', 'Action source должен содержать ровно один defineAction({...}).', 'source', calls[1] ?? calls[0]))
    return { payload, diagnostics, dependencies }
  }

  const definition = calls[0]!.arguments[0]
  if (!definition || !t.isObjectExpression(definition)) {
    diagnostics.push(diagnostic('error', 'action-definition-object', 'defineAction принимает object literal.', 'source', calls[0]))
    return { payload, diagnostics, dependencies }
  }

  const contractNode = objectProperty(definition, 'contract')
  const stepsNode = objectProperty(definition, 'steps')
  const outputNode = expressionProperty(definition, 'output')
  const allowed = new Set(['contract', 'steps', 'output'])
  for (const property of definition.properties) {
    if (!t.isObjectProperty(property) || property.computed) {
      diagnostics.push(diagnostic('error', 'action-definition-property', 'defineAction допускает только обычные properties.', 'source', property))
      continue
    }
    const name = propertyName(property.key)
    if (name && !allowed.has(name)) {
      diagnostics.push(diagnostic('error', 'action-definition-property-unsupported', `Свойство "${name}" не поддерживается.`, name, property))
    }
  }

  let contractInput = null
  let contractOutput = null
  if (contractNode) {
    const value = unwrapExpression(contractNode)
    if (!t.isObjectExpression(value)) {
      diagnostics.push(diagnostic('error', 'action-contract-object', 'contract должен быть object literal.', 'contract', value))
    }
    else {
      for (const key of ['input', 'output'] as const) {
        const fieldNode = expressionProperty(value, key)
        if (!fieldNode) {
          continue
        }
        const compiled = compileSourceField(key, fieldNode, input.source, diagnostics, `contract.${key}`)
        if (!compiled) {
          continue
        }
        if (key === 'input') {
          contractInput = compiled.field
        }
        else { contractOutput = compiled.field }
      }
    }
  }

  if (!stepsNode || !t.isObjectExpression(unwrapExpression(stepsNode))) {
    diagnostics.push(diagnostic('error', 'action-steps-object', 'Action требует steps object.', 'steps', stepsNode ?? definition))
    return { payload, diagnostics, dependencies }
  }
  const block = compileBlock(
    unwrapExpression(stepsNode) as t.ObjectExpression,
    outputNode,
    'steps',
    { source: input.source, diagnostics, dependencies, inputRead: 'action' },
  )
  const document: ActionSourceDocument = {
    contract: { input: contractInput, output: contractOutput },
    ...block,
  }
  payload.sourceDocument = document
  collectDocumentTransforms(document, dependencies)
  return { payload, diagnostics, dependencies: uniqueDependencies(dependencies) }
}

function compileBlock(
  stepsNode: t.ObjectExpression,
  outputNode: t.Expression | null,
  sourcePath: string,
  context: BlockContext,
): ActionSourceBlock {
  const steps: ActionSourceStep[] = []
  const available = new Set<string>()
  for (const property of stepsNode.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      context.diagnostics.push(diagnostic('error', 'action-step-property', 'steps допускает только именованные expression properties.', sourcePath, property))
      continue
    }
    const name = propertyName(property.key)
    if (!name) {
      continue
    }
    if (available.has(name)) {
      context.diagnostics.push(diagnostic('error', 'action-step-duplicate', `Step "${name}" объявлен повторно.`, `${sourcePath}.${name}`, property))
      continue
    }
    const step = compileStep(name, property.value, `${sourcePath}.${name}`, available, context)
    if (step) {
      steps.push(step)
      available.add(name)
    }
  }
  const output = outputNode
    ? compileActionExpression(outputNode, context.diagnostics, `${sourcePath}.output`, available, context.inputRead)
    : null
  return { steps, output }
}

function compileStep(
  name: string,
  raw: t.Expression,
  sourcePath: string,
  available: Set<string>,
  context: BlockContext,
): ActionSourceStep | null {
  const expression = unwrapExpression(raw)
  if (t.isCallExpression(expression) && t.isIdentifier(expression.callee)) {
    const callee = expression.callee.name
    if (callee === 'operation') {
      return compileOperation(name, expression, sourcePath, available, context)
    }
    if (callee === 'typescript') {
      return compileTypescript(name, expression, sourcePath, available, context)
    }
    if (callee === 'query' || callee === 'update' || callee === 'action') {
      const definition = expression.arguments[0]
      if (!definition || !t.isObjectExpression(definition)) {
        context.diagnostics.push(diagnostic('error', `action-${callee}-object`, `${callee}(...) принимает object literal.`, sourcePath, expression))
        return null
      }
      const identityExpression = expressionProperty(definition, 'identity')
      const identityNode = identityExpression ? unwrapExpression(identityExpression) : null
      const identity = staticStringProperty(definition, 'identity')
      const inputNode = expressionProperty(definition, 'input') ?? t.objectExpression([])
      if (!identity) {
        context.diagnostics.push(diagnostic('error', `action-${callee}-identity`, `${callee}(...) требует static identity.`, `${sourcePath}.identity`, definition))
      }
      const compiledInput = compileActionExpression(inputNode, context.diagnostics, `${sourcePath}.input`, available, context.inputRead)
      if (!identity || !compiledInput) {
        return null
      }
      context.dependencies.push({
        entityType: callee,
        id: identity,
        identity,
        role: 'action-step',
        sourcePath: `${sourcePath}.identity`,
        start: identityNode?.start ?? undefined,
        end: identityNode?.end ?? undefined,
      })
      return { kind: callee, name, identity, input: compiledInput }
    }
    if (callee === 'computation') {
      const identityNode = expression.arguments[0]
      const inputNode = expression.arguments[1]
      const identity = t.isStringLiteral(identityNode) ? identityNode.value.trim() : ''
      if (!identity || !inputNode || !t.isExpression(inputNode) || expression.arguments.length !== 2) {
        context.diagnostics.push(diagnostic('error', 'action-computation-call', 'computation(identity, input) требует static identity и input expression.', sourcePath, expression))
        return null
      }
      const compiledInput = compileActionExpression(inputNode, context.diagnostics, `${sourcePath}.input`, available, context.inputRead)
      if (!compiledInput) {
        return null
      }
      context.dependencies.push({
        entityType: 'computation',
        id: identity,
        identity,
        role: 'action-step',
        sourcePath: `${sourcePath}.identity`,
        start: identityNode?.start ?? undefined,
        end: identityNode?.end ?? undefined,
      })
      return { kind: 'computation', name, identity, input: compiledInput }
    }
  }
  const compiled = compileActionExpression(expression, context.diagnostics, sourcePath, available, context.inputRead)
  return compiled ? { kind: 'expression', name, expression: compiled } : null
}

function compileOperation(
  name: string,
  call: t.CallExpression,
  sourcePath: string,
  available: Set<string>,
  context: BlockContext,
): ActionSourceStep | null {
  const definition = call.arguments[0]
  if (!definition || !t.isObjectExpression(definition)) {
    context.diagnostics.push(diagnostic('error', 'action-operation-object', 'operation(...) принимает object literal.', sourcePath, call))
    return null
  }
  const inputNode = expressionProperty(definition, 'input')
  const runNode = objectProperty(definition, 'run')
  const undoNode = objectProperty(definition, 'undo')
  const redoNode = objectProperty(definition, 'redo')
  if (!runNode) {
    context.diagnostics.push(diagnostic('error', 'action-operation-run-required', 'operation.run обязателен.', `${sourcePath}.run`, definition))
  }
  if (!undoNode) {
    context.diagnostics.push(diagnostic('error', 'action-operation-undo-required', 'Operation без undo не допускается.', `${sourcePath}.undo`, definition))
  }
  const operationInput = inputNode
    ? compileActionExpression(inputNode, context.diagnostics, `${sourcePath}.input`, available, context.inputRead)
    : null
  const run = runNode ? compileNestedBlock(runNode, `${sourcePath}.run`, context, 'operation-run') : null
  const undo = undoNode ? compileNestedBlock(undoNode, `${sourcePath}.undo`, context, 'operation-undo') : null
  const redo = redoNode ? compileNestedBlock(redoNode, `${sourcePath}.redo`, context, 'operation-redo') : null
  if ((inputNode && !operationInput) || !run || !undo) {
    return null
  }
  return { kind: 'operation', name, input: operationInput, run, undo, redo }
}

function compileNestedBlock(
  raw: t.Expression,
  sourcePath: string,
  parent: BlockContext,
  inputRead: BlockContext['inputRead'],
): ActionSourceBlock | null {
  const definition = unwrapExpression(raw)
  if (!t.isObjectExpression(definition)) {
    const step = compileStep('default', definition, `${sourcePath}.default`, new Set(), { ...parent, inputRead })
    return step ? { steps: [step], output: null } : null
  }
  const steps = objectProperty(definition, 'steps')
  const output = expressionProperty(definition, 'output')
  if (!steps || !t.isObjectExpression(unwrapExpression(steps))) {
    parent.diagnostics.push(diagnostic('error', 'action-operation-steps-required', `${sourcePath}.steps должен быть object literal.`, `${sourcePath}.steps`, definition))
    return null
  }
  return compileBlock(unwrapExpression(steps) as t.ObjectExpression, output, sourcePath, { ...parent, inputRead })
}

function compileTypescript(
  name: string,
  call: t.CallExpression,
  sourcePath: string,
  available: Set<string>,
  context: BlockContext,
): ActionSourceTypescriptStep | null {
  const definition = call.arguments[0]
  if (!definition || !t.isObjectExpression(definition)) {
    context.diagnostics.push(diagnostic('error', 'action-typescript-object', 'typescript(...) принимает object literal.', sourcePath, call))
    return null
  }
  const inputsNode = objectProperty(definition, 'inputs')
  const compute = definition.properties.find(property => (t.isObjectMethod(property) || t.isObjectProperty(property)) && propertyName(property.key) === 'compute')
  if (!inputsNode || !t.isObjectExpression(unwrapExpression(inputsNode))) {
    context.diagnostics.push(diagnostic('error', 'action-typescript-inputs-required', 'typescript.inputs должен быть object literal.', `${sourcePath}.inputs`, definition))
    return null
  }
  let functionNode: t.ObjectMethod | t.FunctionExpression | t.ArrowFunctionExpression | null = null
  if (t.isObjectMethod(compute)) {
    functionNode = compute
  }
  else if (t.isObjectProperty(compute) && (t.isFunctionExpression(compute.value) || t.isArrowFunctionExpression(compute.value))) {
    functionNode = compute.value
  }
  if (!functionNode) {
    context.diagnostics.push(diagnostic('error', 'action-typescript-compute-required', 'typescript.compute должен быть function или method.', `${sourcePath}.compute`, definition))
    return null
  }
  if (functionNode.async || functionNode.generator) {
    context.diagnostics.push(diagnostic('error', 'action-typescript-async', 'typescript.compute должен быть синхронным.', `${sourcePath}.compute`, functionNode))
  }
  validateSandboxBody(functionNode, context.diagnostics, `${sourcePath}.compute`)
  const source = functionSource(functionNode, context.source)
  const inputs: Record<string, SourceExpressionIR> = {}
  for (const property of (unwrapExpression(inputsNode) as t.ObjectExpression).properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      continue
    }
    const key = propertyName(property.key)
    if (!key) {
      continue
    }
    const value = compileActionExpression(property.value, context.diagnostics, `${sourcePath}.inputs.${key}`, available, context.inputRead)
    if (value) {
      inputs[key] = value
    }
  }
  return { kind: 'typescript', name, inputs, source, moduleKey: hash(`${name}:${source}`) }
}

function compileActionExpression(
  raw: t.Expression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
  available: Set<string>,
  inputRead: BlockContext['inputRead'],
): SourceExpressionIR | null {
  // The compiler owns this parsed AST. Transform it in place so diagnostics retain exact source offsets.
  const node = raw
  walk(node, (current) => {
    if (!t.isCallExpression(current) || !t.isIdentifier(current.callee)) {
      return
    }
    if (current.callee.name === 'input') {
      if (current.arguments.length > 1 || (current.arguments[0] && !t.isStringLiteral(current.arguments[0]))) {
        diagnostics.push(diagnostic('error', 'action-input-path', 'input(...) принимает optional string path.', sourcePath, current))
      }
      current.callee = t.identifier('path')
      if (current.arguments.length === 0) {
        current.arguments = [t.stringLiteral('')]
      }
    }
    else if (current.callee.name === 'output') {
      const name = current.arguments[0]
      const reference = t.isStringLiteral(name) ? name.value : ''
      if (!reference) {
        diagnostics.push(diagnostic('error', 'action-output-name', 'output(...) принимает имя выполненного шага.', sourcePath, current))
      }
      else if (!available.has(reference)) {
        diagnostics.push(diagnostic('error', 'action-output-forward-reference', `Step "${reference}" ещё не выполнен или не существует.`, sourcePath, current))
      }
      current.callee = t.identifier('__computationOutput')
    }
    else if (current.callee.name === 'runOutput' || current.callee.name === 'undoOutput') {
      const operationOutput = current.callee.name
      const allowed = operationOutput === 'runOutput'
        ? inputRead === 'operation-undo' || inputRead === 'operation-redo'
        : inputRead === 'operation-redo'
      if (!allowed) {
        diagnostics.push(diagnostic('error', 'action-operation-output-scope', `${operationOutput}(...) недоступен в этом Operation block.`, sourcePath, current))
      }
      current.callee = t.identifier('path')
      current.arguments = [t.stringLiteral(operationOutput === 'runOutput' ? '__runOutput' : '__undoOutput')]
    }
  })
  return compileSourceExpression(node, diagnostics, sourcePath)
}

function objectProperty(node: t.ObjectExpression, name: string): t.Expression | null {
  return expressionProperty(node, name)
}

function expressionProperty(node: t.ObjectExpression, name: string): t.Expression | null {
  for (const property of node.properties) {
    if (t.isObjectProperty(property) && !property.computed && propertyName(property.key) === name && t.isExpression(property.value)) {
      return property.value
    }
  }
  return null
}

function staticStringProperty(node: t.ObjectExpression, name: string): string {
  const value = expressionProperty(node, name)
  return value && t.isStringLiteral(unwrapExpression(value)) ? (unwrapExpression(value) as t.StringLiteral).value.trim() : ''
}

function walk(node: t.Node, visit: (node: t.Node) => void): void {
  visit(node)
  for (const key of (t.VISITOR_KEYS as Record<string, string[]>)[node.type] ?? []) {
    const value = (node as any)[key]
    if (Array.isArray(value)) {
      value.forEach(child => child?.type && walk(child, visit))
    }
    else if (value?.type) {
      walk(value, visit)
    }
  }
}

function uniqueDependencies(dependencies: ProgramDependency[]): ProgramDependency[] {
  const unique = new Map<string, ProgramDependency>()
  for (const dependency of dependencies) {
    unique.set(`${dependency.entityType}:${dependency.identity}`, dependency)
  }
  return [...unique.values()]
}

function collectDocumentTransforms(document: ActionSourceDocument, dependencies: ProgramDependency[]): void {
  const visitExpression = (expression: SourceExpressionIR): void => {
    if (expression.type === 'transform') {
      dependencies.push({
        entityType: expression.transform === 'data-view' ? 'data-view' : 'converter',
        id: expression.identity,
        identity: expression.identity,
        role: 'action-value-transform',
      })
      visitExpression(expression.input)
      if (expression.options) {
        visitExpression(expression.options)
      }
      return
    }
    if (expression.type === 'array') {
      expression.items.forEach(visitExpression)
    }
    else if (expression.type === 'object') {
      Object.values(expression.properties).forEach(visitExpression)
    }
    else if (expression.type === 'operation') {
      expression.arguments.forEach(visitExpression)
    }
  }
  const visitBlock = (block: ActionSourceBlock): void => {
    if (block.output) {
      visitExpression(block.output)
    }
    for (const step of block.steps) {
      if (step.kind === 'expression') {
        visitExpression(step.expression)
      }
      else if (step.kind === 'typescript') {
        Object.values(step.inputs).forEach(visitExpression)
      }
      else if (step.kind === 'operation') {
        if (step.input) {
          visitExpression(step.input)
        }
        visitBlock(step.run)
        visitBlock(step.undo)
        if (step.redo) {
          visitBlock(step.redo)
        }
      }
      else {
        visitExpression(step.input)
      }
    }
  }
  visitBlock(document)
}

function hash(value: string): string {
  let result = 2166136261
  for (let index = 0; index < value.length; index++) {
    result = Math.imul(result ^ value.charCodeAt(index), 16777619)
  }
  return (result >>> 0).toString(16)
}
