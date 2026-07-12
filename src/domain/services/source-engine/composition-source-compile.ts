import type {
  CompositionBindingValue,
  CompositionOutputDescriptor,
  CompositionReaction,
  CompositionRuntimeDescriptor,
  CompositionRuntimeKind,
  CompositionSourceCompileResult,
  CompositionSourceDocument,
} from '@/domain/types/composition-source.types'
import type { ProgramDiagnostic } from '@/domain/types/program.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import {
  diagnostic,
  propertyName,
  readStringArgument,
  unwrapExpression,
} from '@/domain/services/source-engine/source-expression-compile'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

/** Компилирует Composition source v1 в runtime graph artifact. */
export function compileCompositionSource(source: string, sourceVersion = 1): CompositionSourceCompileResult {
  const diagnostics: DiagnosticDraft[] = []
  if (!String(source ?? '').trim()) {
    diagnostics.push(diagnostic('error', 'composition-source-empty', 'Composition source пуст.'))
    return { ast: null, document: null, artifact: null, diagnostics }
  }

  try {
    const ast = parseTS(source, { sourceType: 'module', plugins: ['typescript'] })
    const call = findDefineComposition(ast)
    const definition = call?.arguments[0]
    if (!call) {
      diagnostics.push(diagnostic('error', 'composition-source-define-missing', 'Composition source должен содержать defineComposition({...}).'))
      return { ast, document: null, artifact: null, diagnostics }
    }
    if (!definition || !t.isObjectExpression(definition)) {
      diagnostics.push(diagnostic('error', 'composition-source-definition', 'defineComposition принимает объектный литерал.', 'defineComposition', call))
      return { ast, document: null, artifact: null, diagnostics }
    }

    validateRootProperties(definition, diagnostics)
    const runtimesNode = objectProperty(definition, 'runtimes')
    const reactionsNode = arrayProperty(definition, 'reactions')
    const outputsNode = objectProperty(definition, 'outputs')
    const runtimes = runtimesNode ? readRuntimes(runtimesNode, diagnostics) : []
    const runtimeNames = new Set(runtimes.map(item => item.name))
    const reactions = reactionsNode ? readReactions(reactionsNode, runtimeNames, runtimes, diagnostics) : []
    const outputs = outputsNode ? readOutputs(outputsNode, runtimeNames, diagnostics) : []

    if (!runtimesNode)
      diagnostics.push(diagnostic('error', 'composition-source-runtimes-missing', 'defineComposition требует runtimes.', 'runtimes', definition))
    if (!outputsNode)
      diagnostics.push(diagnostic('error', 'composition-source-outputs-missing', 'defineComposition требует outputs.', 'outputs', definition))

    validatePersistKeys(runtimes, diagnostics)
    validateBindingReferences(runtimes, diagnostics)
    validateRuntimeCycles(runtimes, reactions, diagnostics)

    const document: CompositionSourceDocument = { runtimes, reactions, outputs }
    const hasErrors = diagnostics.some(item => item.severity === 'error')
    return {
      ast,
      document: hasErrors ? null : document,
      artifact: hasErrors ? null : { type: 'composition', sourceVersion, ...document },
      diagnostics,
    }
  }
  catch (error: any) {
    diagnostics.push(diagnostic('error', 'composition-source-parse-error', `Не удалось распарсить Composition source: ${error?.message ?? error}`))
    return { ast: null, document: null, artifact: null, diagnostics }
  }
}

function findDefineComposition(ast: t.File): t.CallExpression | null {
  for (const statement of ast.program.body) {
    if (!t.isExpressionStatement(statement))
      continue
    const expression = unwrapExpression(statement.expression)
    if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'defineComposition' }))
      return expression
  }
  return null
}

function validateRootProperties(node: t.ObjectExpression, diagnostics: DiagnosticDraft[]): void {
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed) {
      diagnostics.push(diagnostic('error', 'composition-source-property', 'defineComposition допускает только обычные properties.', 'defineComposition', property))
      continue
    }
    const name = propertyName(property.key)
    if (name !== 'runtimes' && name !== 'reactions' && name !== 'outputs')
      diagnostics.push(diagnostic('error', 'composition-source-property-unsupported', `Свойство "${name ?? ''}" не поддерживается Composition v1.`, name ?? 'defineComposition', property))
  }
}

function readRuntimes(node: t.ObjectExpression, diagnostics: DiagnosticDraft[]): CompositionRuntimeDescriptor[] {
  const runtimes: CompositionRuntimeDescriptor[] = []
  const declared = new Set<string>()
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      diagnostics.push(diagnostic('error', 'composition-runtime-property', 'runtimes допускает только обычные object properties.', 'runtimes', property))
      continue
    }
    const name = propertyName(property.key)
    if (!name)
      continue
    if (declared.has(name)) {
      diagnostics.push(diagnostic('error', 'composition-runtime-duplicate', `Runtime "${name}" объявлен повторно.`, `runtimes.${name}`, property))
      continue
    }
    declared.add(name)
    const runtime = readRuntime(name, property.value, diagnostics)
    if (runtime)
      runtimes.push(runtime)
  }
  return runtimes
}

function readRuntime(name: string, raw: t.Expression, diagnostics: DiagnosticDraft[]): CompositionRuntimeDescriptor | null {
  const chain = memberChain(raw)
  if (!chain || !t.isIdentifier(chain.base.callee)) {
    diagnostics.push(diagnostic('error', 'composition-runtime-shape', `Runtime "${name}" должен начинаться с filter/query/component/filterFields(identity).`, `runtimes.${name}`, raw))
    return null
  }

  const rawKind = chain.base.callee.name
  const kind = (rawKind === 'filterFields' ? 'filter-fields' : rawKind) as CompositionRuntimeKind
  if (kind !== 'filter' && kind !== 'query' && kind !== 'component' && kind !== 'filter-fields') {
    diagnostics.push(diagnostic('error', 'composition-runtime-kind', `Runtime kind "${rawKind}" не поддерживается.`, `runtimes.${name}`, chain.base))
    return null
  }
  const identity = readStringArgument(chain.base, 0)
  if (!identity) {
    diagnostics.push(diagnostic('error', 'composition-runtime-identity', `Runtime "${name}" требует identity/source runtime.`, `runtimes.${name}`, chain.base))
    return null
  }

  const descriptor: CompositionRuntimeDescriptor = {
    name,
    kind,
    identity,
    instance: 'default',
    props: {},
  }

  for (const modifier of chain.modifiers) {
    if (modifier.name === 'fields') {
      if (kind !== 'filter-fields') {
        diagnostics.push(diagnostic('error', 'composition-fields-runtime-kind', '.fields(...) в v1 поддерживается только filterFields(...).', `runtimes.${name}.fields`, modifier.call))
        continue
      }
      const fields = readStringArrayArgument(modifier.call, 0)
      if (!fields?.length)
        diagnostics.push(diagnostic('error', 'composition-filter-fields-empty', '.fields([...]) требует непустой массив field keys.', `runtimes.${name}.fields`, modifier.call))
      else
        descriptor.fields = [...new Set(fields)]
      continue
    }
    if (modifier.name === 'instance') {
      if (kind === 'filter-fields') {
        diagnostics.push(diagnostic('error', 'composition-filter-fields-instance-unsupported', 'filterFields runtime не поддерживает .instance(...).', `runtimes.${name}.instance`, modifier.call))
        continue
      }
      descriptor.instance = readStringArgument(modifier.call, 0) ?? 'default'
      continue
    }
    if (modifier.name === 'persist') {
      if (kind !== 'filter') {
        diagnostics.push(diagnostic('error', 'composition-persist-runtime-kind', '.persist(...) в v1 поддерживается только Filter runtime.', `runtimes.${name}.persist`, modifier.call))
        continue
      }
      const config = modifier.call.arguments[0]
      const key = config && t.isObjectExpression(config) ? stringProperty(config, 'key') : null
      if (!key)
        diagnostics.push(diagnostic('error', 'composition-persist-key', '.persist({ key }) требует непустой key.', `runtimes.${name}.persist`, modifier.call))
      else
        descriptor.persistKey = key
      continue
    }
    if (modifier.name === 'withProps') {
      if (kind === 'filter' || kind === 'filter-fields') {
        diagnostics.push(diagnostic('error', 'composition-filter-props-unsupported', 'Filter runtime v1 не принимает .withProps(...).', `runtimes.${name}.withProps`, modifier.call))
        continue
      }
      const config = modifier.call.arguments[0]
      if (!config || !t.isObjectExpression(config)) {
        diagnostics.push(diagnostic('error', 'composition-props-object', '.withProps(...) принимает object literal.', `runtimes.${name}.withProps`, modifier.call))
        continue
      }
      descriptor.props = readBindings(config, diagnostics, `runtimes.${name}.withProps`)
      continue
    }

    diagnostics.push(diagnostic('error', 'composition-runtime-method', `.${modifier.name}(...) не поддерживается runtime descriptor.`, `runtimes.${name}`, modifier.call))
  }
  if (kind === 'filter-fields' && !descriptor.fields?.length)
    diagnostics.push(diagnostic('error', 'composition-filter-fields-missing', `Runtime "${name}" требует .fields([...]).`, `runtimes.${name}`, raw))
  return descriptor
}

function readBindings(
  node: t.ObjectExpression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): Record<string, CompositionBindingValue> {
  const bindings: Record<string, CompositionBindingValue> = {}
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      diagnostics.push(diagnostic('error', 'composition-binding-property', 'withProps допускает обычные properties.', sourcePath, property))
      continue
    }
    const key = propertyName(property.key)
    if (!key)
      continue
    const expression = unwrapExpression(property.value)
    if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'fromOutput' })) {
      const runtime = readStringArgument(expression, 0)
      const output = readStringArgument(expression, 1)
      if (!runtime || !output)
        diagnostics.push(diagnostic('error', 'composition-binding-output', 'fromOutput(runtime, output) требует две строки.', `${sourcePath}.${key}`, expression))
      else
        bindings[key] = { kind: 'output', runtime, output }
      continue
    }
    if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'fromStore' })) {
      const storeKey = readStringArgument(expression, 0)
      if (!storeKey)
        diagnostics.push(diagnostic('error', 'composition-binding-store', 'fromStore(key) требует непустую строку.', `${sourcePath}.${key}`, expression))
      else
        bindings[key] = { kind: 'store', key: storeKey }
      continue
    }
    const filterBinding = readFilterFieldsBinding(expression, diagnostics, `${sourcePath}.${key}`)
    if (filterBinding) {
      bindings[key] = filterBinding
      continue
    }

    const value = staticValue(expression)
    if (!value.ok)
      diagnostics.push(diagnostic('error', 'composition-binding-literal', 'Literal binding допускает только JSON-compatible значения.', `${sourcePath}.${key}`, expression))
    else
      bindings[key] = { kind: 'literal', value: value.value }
  }
  return bindings
}

function readReactions(
  node: t.ArrayExpression,
  runtimeNames: Set<string>,
  runtimes: CompositionRuntimeDescriptor[],
  diagnostics: DiagnosticDraft[],
): CompositionReaction[] {
  const reactions: CompositionReaction[] = []
  node.elements.forEach((element, index) => {
    if (!element || !t.isExpression(element))
      return
    const chain = memberChain(element)
    if (!chain || !t.isIdentifier(chain.base.callee)) {
      diagnostics.push(diagnostic('error', 'composition-reaction-shape', 'Reaction должна начинаться с onMount() или onChange(path).', `reactions.${index}`, element))
      return
    }
    const root = chain.base.callee.name
    if (root !== 'onMount' && root !== 'onChange') {
      diagnostics.push(diagnostic('error', 'composition-reaction-kind', `Reaction "${root}" не поддерживается.`, `reactions.${index}`, chain.base))
      return
    }
    let target = ''
    let debounceMs = 200
    for (const modifier of chain.modifiers) {
      if (modifier.name === 'run')
        target = readStringArgument(modifier.call, 0) ?? ''
      else if (modifier.name === 'debounce') {
        const value = modifier.call.arguments[0]
        debounceMs = value && t.isNumericLiteral(value) ? value.value : Number.NaN
      }
      else
        diagnostics.push(diagnostic('error', 'composition-reaction-method', `Reaction method ".${modifier.name}" не поддерживается.`, `reactions.${index}`, modifier.call))
    }
    if (!target || !runtimeNames.has(target)) {
      diagnostics.push(diagnostic('error', 'composition-reaction-target', `Reaction target "${target}" не найден.`, `reactions.${index}`, element))
      return
    }
    if (runtimes.find(item => item.name === target)?.kind !== 'query') {
      diagnostics.push(diagnostic('error', 'composition-reaction-target-kind', 'Reaction v1 может запускать только Query runtime.', `reactions.${index}`, element))
      return
    }
    if (root === 'onMount') {
      reactions.push({ kind: 'mount', target })
      return
    }
    if (!Number.isInteger(debounceMs) || debounceMs < 0 || debounceMs > 60000) {
      diagnostics.push(diagnostic('error', 'composition-reaction-debounce', 'debounce должен быть целым числом от 0 до 60000.', `reactions.${index}`, element))
      return
    }
    const path = readStringArgument(chain.base, 0) ?? ''
    const dot = path.indexOf('.')
    const runtime = dot > 0 ? path.slice(0, dot) : ''
    const output = dot > 0 ? path.slice(dot + 1) : ''
    if (!runtimeNames.has(runtime) || !output) {
      diagnostics.push(diagnostic('error', 'composition-reaction-path', `onChange path "${path}" должен иметь вид runtime.output.`, `reactions.${index}`, chain.base))
      return
    }
    reactions.push({ kind: 'change', runtime, output, target, debounceMs })
  })
  return reactions
}

function readOutputs(
  node: t.ObjectExpression,
  runtimeNames: Set<string>,
  diagnostics: DiagnosticDraft[],
): CompositionOutputDescriptor[] {
  const outputs: CompositionOutputDescriptor[] = []
  const declared = new Set<string>()
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value))
      continue
    const key = propertyName(property.key)
    if (!key)
      continue
    if (declared.has(key)) {
      diagnostics.push(diagnostic('error', 'composition-output-duplicate', `Output "${key}" объявлен повторно.`, `outputs.${key}`, property))
      continue
    }
    declared.add(key)
    const chain = memberChain(property.value)
    if (!chain || !t.isIdentifier(chain.base.callee, { name: 'output' })) {
      diagnostics.push(diagnostic('error', 'composition-output-shape', `Output "${key}" должен начинаться с output().fromRuntime(...).`, `outputs.${key}`, property.value))
      continue
    }
    let runtime = ''
    let selected: string | undefined
    for (const modifier of chain.modifiers) {
      if (modifier.name === 'fromRuntime')
        runtime = readStringArgument(modifier.call, 0) ?? ''
      else if (modifier.name === 'select')
        selected = readStringArgument(modifier.call, 0) ?? undefined
      else
        diagnostics.push(diagnostic('error', 'composition-output-method', `Output method ".${modifier.name}" не поддерживается.`, `outputs.${key}`, modifier.call))
    }
    if (!runtimeNames.has(runtime)) {
      diagnostics.push(diagnostic('error', 'composition-output-runtime', `Runtime "${runtime}" не найден.`, `outputs.${key}`, property.value))
      continue
    }
    outputs.push({ key, runtime, output: selected })
  }
  return outputs
}

function validatePersistKeys(runtimes: CompositionRuntimeDescriptor[], diagnostics: DiagnosticDraft[]): void {
  const keys = new Set<string>()
  for (const runtime of runtimes) {
    if (!runtime.persistKey)
      continue
    if (keys.has(runtime.persistKey))
      diagnostics.push(diagnostic('error', 'composition-persist-key-duplicate', `Persist key "${runtime.persistKey}" повторяется внутри Composition.`, `runtimes.${runtime.name}.persist`))
    keys.add(runtime.persistKey)
  }
}

function validateBindingReferences(runtimes: CompositionRuntimeDescriptor[], diagnostics: DiagnosticDraft[]): void {
  const runtimeByName = new Map(runtimes.map(runtime => [runtime.name, runtime]))
  for (const runtime of runtimes) {
    if (runtime.kind === 'filter-fields') {
      const source = runtimeByName.get(runtime.identity)
      if (!source) {
        diagnostics.push(diagnostic(
          'error',
          'composition-filter-fields-source-missing',
          `filterFields source runtime "${runtime.identity}" не найден.`,
          `runtimes.${runtime.name}`,
        ))
      }
      else if (source.kind !== 'filter') {
        diagnostics.push(diagnostic(
          'error',
          'composition-filter-fields-source-kind',
          `filterFields source "${runtime.identity}" должен быть Filter runtime.`,
          `runtimes.${runtime.name}`,
        ))
      }
    }
    for (const [prop, binding] of Object.entries(runtime.props)) {
      if ((binding.kind === 'output' || binding.kind === 'filter-fields') && !runtimeByName.has(binding.runtime)) {
        diagnostics.push(diagnostic(
          'error',
          'composition-binding-runtime-missing',
          `Binding ссылается на отсутствующий runtime "${binding.runtime}".`,
          `runtimes.${runtime.name}.withProps.${prop}`,
        ))
      }
      if (binding.kind === 'filter-fields' && runtimeByName.get(binding.runtime)?.kind !== 'filter') {
        diagnostics.push(diagnostic(
          'error',
          'composition-binding-filter-runtime-kind',
          `fromFilter(...) должен ссылаться на Filter runtime, получен "${runtimeByName.get(binding.runtime)?.kind ?? ''}".`,
          `runtimes.${runtime.name}.withProps.${prop}`,
        ))
      }
    }
  }
}

function validateRuntimeCycles(
  runtimes: CompositionRuntimeDescriptor[],
  reactions: CompositionReaction[],
  diagnostics: DiagnosticDraft[],
): void {
  const edges = new Map<string, string[]>()
  for (const runtime of runtimes) {
    const propEdges = Object.values(runtime.props)
      .filter((binding): binding is Extract<CompositionBindingValue, { kind: 'output' | 'filter-fields' }> => binding.kind === 'output' || binding.kind === 'filter-fields')
      .map(binding => binding.runtime)
    edges.set(runtime.name, runtime.kind === 'filter-fields'
      ? [runtime.identity, ...propEdges]
      : propEdges)
  }
  for (const reaction of reactions) {
    if (reaction.kind === 'change')
      edges.set(reaction.target, [...(edges.get(reaction.target) ?? []), reaction.runtime])
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (name: string): boolean => {
    if (visiting.has(name))
      return true
    if (visited.has(name))
      return false
    visiting.add(name)
    const cycle = (edges.get(name) ?? []).some(visit)
    visiting.delete(name)
    visited.add(name)
    return cycle
  }
  for (const runtime of runtimes) {
    if (visit(runtime.name)) {
      diagnostics.push(diagnostic('error', 'composition-binding-cycle', `Runtime bindings/reactions содержат цикл около "${runtime.name}".`, `runtimes.${runtime.name}`))
      return
    }
  }
}

function memberChain(raw: t.Expression): {
  base: t.CallExpression
  modifiers: Array<{ name: string, call: t.CallExpression }>
} | null {
  let current = unwrapExpression(raw)
  const modifiers: Array<{ name: string, call: t.CallExpression }> = []
  while (t.isCallExpression(current) && t.isMemberExpression(current.callee)) {
    const name = propertyName(current.callee.property)
    if (!name || !t.isExpression(current.callee.object))
      return null
    modifiers.unshift({ name, call: current })
    current = unwrapExpression(current.callee.object)
  }
  return t.isCallExpression(current) ? { base: current, modifiers } : null
}

function readFilterFieldsBinding(
  expression: t.Expression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): Extract<CompositionBindingValue, { kind: 'filter-fields' }> | null {
  const chain = memberChain(expression)
  if (!chain || !t.isIdentifier(chain.base.callee, { name: 'fromFilter' }))
    return null

  const runtime = readStringArgument(chain.base, 0)
  if (!runtime) {
    diagnostics.push(diagnostic('error', 'composition-binding-filter-runtime', 'fromFilter(runtime) требует имя Filter runtime.', sourcePath, expression))
    return null
  }

  const fieldsCall = chain.modifiers.find(modifier => modifier.name === 'fields')?.call
  if (!fieldsCall || chain.modifiers.some(modifier => modifier.name !== 'fields')) {
    diagnostics.push(diagnostic('error', 'composition-binding-filter-fields', 'fromFilter(...).fields([...]) требует единственный modifier .fields(...).', sourcePath, expression))
    return null
  }

  const fields = readStringArrayArgument(fieldsCall, 0)
  if (!fields) {
    diagnostics.push(diagnostic('error', 'composition-binding-filter-fields-array', '.fields(...) принимает массив field keys.', sourcePath, fieldsCall))
    return null
  }

  return { kind: 'filter-fields', runtime, fields: [...new Set(fields)] }
}

function readStringArrayArgument(call: t.CallExpression, index: number): string[] | null {
  const argument = call.arguments[index]
  if (!argument || !t.isArrayExpression(argument))
    return null
  const out: string[] = []
  for (const element of argument.elements) {
    if (!element || !t.isStringLiteral(element))
      return null
    out.push(element.value)
  }
  return out
}

function objectProperty(node: t.ObjectExpression, name: string): t.ObjectExpression | null {
  const value = propertyValue(node, name)
  return value && t.isObjectExpression(value) ? value : null
}

function arrayProperty(node: t.ObjectExpression, name: string): t.ArrayExpression | null {
  const value = propertyValue(node, name)
  return value && t.isArrayExpression(value) ? value : null
}

function propertyValue(node: t.ObjectExpression, name: string): t.Expression | null {
  for (const property of node.properties) {
    if (t.isObjectProperty(property) && !property.computed && propertyName(property.key) === name && t.isExpression(property.value))
      return unwrapExpression(property.value)
  }
  return null
}

function stringProperty(node: t.ObjectExpression, name: string): string | null {
  const value = propertyValue(node, name)
  return value && t.isStringLiteral(value) ? value.value : null
}

function staticValue(node: t.Expression): { ok: true, value: unknown } | { ok: false } {
  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node))
    return { ok: true, value: node.value }
  if (t.isNullLiteral(node))
    return { ok: true, value: null }
  if (t.isArrayExpression(node)) {
    const out: unknown[] = []
    for (const item of node.elements) {
      if (!item || !t.isExpression(item))
        return { ok: false }
      const value = staticValue(unwrapExpression(item))
      if (!value.ok)
        return value
      out.push(value.value)
    }
    return { ok: true, value: out }
  }
  if (t.isObjectExpression(node)) {
    const out: Record<string, unknown> = {}
    for (const property of node.properties) {
      if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value))
        return { ok: false }
      const key = propertyName(property.key)
      if (!key)
        return { ok: false }
      const value = staticValue(unwrapExpression(property.value))
      if (!value.ok)
        return value
      out[key] = value.value
    }
    return { ok: true, value: out }
  }
  return { ok: false }
}
