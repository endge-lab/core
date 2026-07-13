import type {
  CompositionBindingValue,
  CompositionDataDescriptor,
  CompositionOutputDescriptor,
  CompositionHook,
  CompositionRuntimeDescriptor,
  CompositionRuntimeGraph,
  CompositionRuntimeKind,
  CompositionSourceCompileResult,
  CompositionSourceDocument,
} from '@/domain/types/composition-source.types'
import type {
  FilterViewControlDefinition,
  FilterViewControlType,
} from '@/domain/types/filter-view.type'
import type { ProgramDiagnostic } from '@/domain/types/program.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import {
  diagnostic,
  propertyName,
  readStringArgument,
  unwrapExpression,
} from '@/domain/services/source-engine/source-expression-compile'
import { compileProgramMetadataProperty } from '@/domain/services/source-engine/source-metadata-compile'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

/** Компилирует Composition source v1 в runtime graph artifact. */
export function compileCompositionSource(source: string, sourceVersion = 1): CompositionSourceCompileResult {
  const diagnostics: DiagnosticDraft[] = []
  if (!String(source ?? '').trim()) {
    diagnostics.push(diagnostic('error', 'composition-source-empty', 'Composition source пуст.'))
    return { ast: null, document: null, artifact: null, metadata: {}, diagnostics }
  }

  try {
    const ast = parseTS(source, { sourceType: 'module', plugins: ['typescript'] })
    const call = findDefineComposition(ast)
    const definition = call?.arguments[0]
    if (!call) {
      diagnostics.push(diagnostic('error', 'composition-source-define-missing', 'Composition source должен содержать defineComposition({...}).'))
      return { ast, document: null, artifact: null, metadata: {}, diagnostics }
    }
    if (!definition || !t.isObjectExpression(definition)) {
      diagnostics.push(diagnostic('error', 'composition-source-definition', 'defineComposition принимает объектный литерал.', 'defineComposition', call))
      return { ast, document: null, artifact: null, metadata: {}, diagnostics }
    }

    validateRootProperties(definition, diagnostics)
    const metadata = compileProgramMetadataProperty(definition, diagnostics)
    const dataValue = propertyValue(definition, 'data')
    const runtimesValue = propertyValue(definition, 'runtimes')
    const hooksValue = propertyValue(definition, 'hooks')
    const outputsValue = propertyValue(definition, 'outputs')
    const dataNode = dataValue && t.isObjectExpression(dataValue) ? dataValue : null
    const runtimesNode = runtimesValue && t.isObjectExpression(runtimesValue) ? runtimesValue : null
    const hooksNode = hooksValue && t.isArrayExpression(hooksValue) ? hooksValue : null
    const outputsNode = outputsValue && t.isObjectExpression(outputsValue) ? outputsValue : null
    if (dataValue && !dataNode)
      diagnostics.push(diagnostic('error', 'composition-source-data-shape', 'data должен быть object literal.', 'data', dataValue))
    if (runtimesValue && !runtimesNode)
      diagnostics.push(diagnostic('error', 'composition-source-runtimes-shape', 'runtimes должен быть object literal.', 'runtimes', runtimesValue))
    if (hooksValue && !hooksNode)
      diagnostics.push(diagnostic('error', 'composition-source-hooks-shape', 'hooks должен быть array literal.', 'hooks', hooksValue))
    if (outputsValue && !outputsNode)
      diagnostics.push(diagnostic('error', 'composition-source-outputs-shape', 'outputs должен быть object literal.', 'outputs', outputsValue))
    const data = dataNode ? readData(dataNode, diagnostics) : []
    const dataNames = new Set(data.map(item => item.name))
    const runtimes = runtimesNode ? readRuntimes(runtimesNode, dataNames, diagnostics) : []
    const runtimeNames = new Set(runtimes.map(item => item.name))
    const hooks = hooksNode ? readHooks(hooksNode, runtimeNames, runtimes, diagnostics) : []
    const outputs = outputsNode ? readOutputs(outputsNode, runtimeNames, diagnostics) : []

    if (!runtimesNode)
      diagnostics.push(diagnostic('error', 'composition-source-runtimes-missing', 'defineComposition требует runtimes.', 'runtimes', definition))
    validatePersistKeys(runtimes, diagnostics)
    validateBindingReferences(data, runtimes, diagnostics)
    validateRuntimeCycles(runtimes, hooks, diagnostics)

    const document: CompositionSourceDocument = { data, runtimes, hooks, outputs }
    const hasErrors = diagnostics.some(item => item.severity === 'error')
    return {
      ast,
      document: hasErrors ? null : document,
      artifact: hasErrors ? null : {
        type: 'composition',
        sourceVersion,
        ...document,
        graph: buildRuntimeGraph(document),
      },
      metadata,
      diagnostics,
    }
  }
  catch (error: any) {
    diagnostics.push(diagnostic('error', 'composition-source-parse-error', `Не удалось распарсить Composition source: ${error?.message ?? error}`))
    return { ast: null, document: null, artifact: null, metadata: {}, diagnostics }
  }
}

/** Строит normalized graph отдельно от source AST, чтобы runtime не интерпретировал DSL. */
export function buildRuntimeGraph(document: CompositionSourceDocument): CompositionRuntimeGraph {
  const inputs = document.runtimes.flatMap(runtime => Object.entries(runtime.props).map(([targetProp, source]) => ({
    targetRuntime: runtime.name,
    targetProp,
    source,
  })))
  const updates = document.hooks.flatMap((hook, index) => hook.kind === 'change'
    ? [{
        id: `hook:${index}:${hook.runtime}.${hook.output}->${hook.target}`,
        sourceRuntime: hook.runtime,
        sourceOutput: hook.output,
        targetRuntime: hook.target,
        updateKind: 'run' as const,
        debounceMs: hook.debounceMs,
      }]
    : [])
  const mounts = document.hooks.flatMap(hook => hook.kind === 'mount'
    ? [{ targetRuntime: hook.target, updateKind: 'run' as const }]
    : [])
  const publications = document.runtimes.flatMap(runtime => runtime.storeTo.flatMap((publication, publicationIndex) => (
    Object.entries(publication.fields).map(([targetPath, sourceOutput]) => ({
      id: `store:${runtime.name}:${publicationIndex}:${sourceOutput}->${publication.data}.${targetPath}`,
      sourceRuntime: runtime.name,
      sourceOutput,
      targetData: publication.data,
      targetPath,
    }))
  )))
  return { inputs, updates, publications, mounts }
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
    if (name !== 'metadata' && name !== 'data' && name !== 'runtimes' && name !== 'hooks' && name !== 'outputs')
      diagnostics.push(diagnostic('error', 'composition-source-property-unsupported', `Свойство "${name ?? ''}" не поддерживается Composition v1.`, name ?? 'defineComposition', property))
  }
}

function readData(node: t.ObjectExpression, diagnostics: DiagnosticDraft[]): CompositionDataDescriptor[] {
  const data: CompositionDataDescriptor[] = []
  const declared = new Set<string>()
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value))
      continue
    const name = propertyName(property.key)
    const expression = unwrapExpression(property.value)
    if (!name || !t.isCallExpression(expression) || !t.isIdentifier(expression.callee)) {
      diagnostics.push(diagnostic('error', 'composition-data-shape', 'data entry должен быть store(identity) или vocab(identity).', `data.${name ?? ''}`, property))
      continue
    }
    if (declared.has(name)) {
      diagnostics.push(diagnostic('error', 'composition-data-duplicate', `Data alias "${name}" объявлен повторно.`, `data.${name}`, property))
      continue
    }
    const kind = expression.callee.name
    if (kind !== 'store' && kind !== 'vocab') {
      diagnostics.push(diagnostic('error', 'composition-data-kind', `Data kind "${kind}" не поддерживается.`, `data.${name}`, expression))
      continue
    }
    const identity = readStringArgument(expression, 0)
    if (!identity) {
      diagnostics.push(diagnostic('error', 'composition-data-identity', `Data "${name}" требует identity.`, `data.${name}`, expression))
      continue
    }
    data.push({ name, kind, identity })
    declared.add(name)
  }
  return data
}

function readRuntimes(node: t.ObjectExpression, dataNames: Set<string>, diagnostics: DiagnosticDraft[]): CompositionRuntimeDescriptor[] {
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
    const runtime = readRuntime(name, property.value, dataNames, diagnostics)
    if (runtime)
      runtimes.push(runtime)
  }
  return runtimes
}

function readRuntime(name: string, raw: t.Expression, dataNames: Set<string>, diagnostics: DiagnosticDraft[]): CompositionRuntimeDescriptor | null {
  const chain = memberChain(raw)
  if (!chain || !t.isIdentifier(chain.base.callee)) {
    diagnostics.push(diagnostic('error', 'composition-runtime-shape', `Runtime "${name}" должен начинаться с filter/query/component/filterView(identity).`, `runtimes.${name}`, raw))
    return null
  }

  const rawKind = chain.base.callee.name
  const kind = (rawKind === 'filterView' ? 'filter-view' : rawKind) as CompositionRuntimeKind
  if (kind !== 'filter' && kind !== 'query' && kind !== 'component' && kind !== 'filter-view') {
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
    props: {},
    storeTo: [],
  }

  for (const modifier of chain.modifiers) {
    if (modifier.name === 'fields') {
      if (kind !== 'filter-view') {
        diagnostics.push(diagnostic('error', 'composition-fields-runtime-kind', '.fields(...) в v1 поддерживается только filterView(...).', `runtimes.${name}.fields`, modifier.call))
        continue
      }
      const fields = readStringArrayArgument(modifier.call, 0)
      if (!fields?.length)
        diagnostics.push(diagnostic('error', 'composition-filter-fields-empty', '.fields([...]) требует непустой массив field keys.', `runtimes.${name}.fields`, modifier.call))
      else
        descriptor.fields = [...new Set(fields)]
      continue
    }
    if (modifier.name === 'controls') {
      if (kind !== 'filter-view') {
        diagnostics.push(diagnostic('error', 'composition-controls-runtime-kind', '.controls(...) поддерживается только filterView(...).', `runtimes.${name}.controls`, modifier.call))
        continue
      }
      const config = modifier.call.arguments[0]
      if (!config || !t.isObjectExpression(config)) {
        diagnostics.push(diagnostic('error', 'composition-filter-view-controls-object', '.controls(...) принимает object literal.', `runtimes.${name}.controls`, modifier.call))
        continue
      }
      descriptor.controls = readFilterViewControls(config, diagnostics, `runtimes.${name}.controls`)
      continue
    }
    if (modifier.name === 'component') {
      if (kind !== 'filter-view') {
        diagnostics.push(diagnostic('error', 'composition-component-runtime-kind', '.component(...) поддерживается только filterView(...).', `runtimes.${name}.component`, modifier.call))
        continue
      }
      const identity = readStringArgument(modifier.call, 0)
      if (!identity)
        diagnostics.push(diagnostic('error', 'composition-filter-view-component-identity', '.component(identity) требует identity.', `runtimes.${name}.component`, modifier.call))
      else
        descriptor.componentIdentity = identity
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
      if (kind === 'filter') {
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
    if (modifier.name === 'storeTo') {
      if (kind !== 'query') {
        diagnostics.push(diagnostic('error', 'composition-store-to-runtime-kind', '.storeTo(...) поддерживается только Query runtime.', `runtimes.${name}.storeTo`, modifier.call))
        continue
      }
      const target = modifier.call.arguments[0]
      const mapping = modifier.call.arguments[1]
      const dataName = readDataTarget(target)
      if (!dataName || !dataNames.has(dataName)) {
        diagnostics.push(diagnostic('error', 'composition-store-to-data', '.storeTo(...) должен ссылаться на объявленный data alias.', `runtimes.${name}.storeTo`, modifier.call))
        continue
      }
      if (!mapping || !t.isObjectExpression(mapping)) {
        diagnostics.push(diagnostic('error', 'composition-store-to-map', '.storeTo(data(...), mapping) требует object mapping.', `runtimes.${name}.storeTo`, modifier.call))
        continue
      }
      const fields: Record<string, string> = {}
      for (const property of mapping.properties) {
        if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value))
          continue
        const field = propertyName(property.key)
        const output = readOutputReference(property.value)
        if (!field || !output) {
          diagnostics.push(diagnostic('error', 'composition-store-to-field', 'storeTo mapping имеет вид { storeField: output(queryOutput) }.', `runtimes.${name}.storeTo`, property))
          continue
        }
        fields[field] = output
      }
      if (!Object.keys(fields).length) {
        diagnostics.push(diagnostic('error', 'composition-store-to-empty', 'storeTo mapping должен содержать хотя бы одно поле.', `runtimes.${name}.storeTo`, mapping))
        continue
      }
      descriptor.storeTo.push({ data: dataName, fields })
      continue
    }

    diagnostics.push(diagnostic('error', 'composition-runtime-method', `.${modifier.name}(...) не поддерживается runtime descriptor.`, `runtimes.${name}`, modifier.call))
  }
  if (kind === 'filter-view' && descriptor.componentIdentity && Object.keys(descriptor.controls ?? {}).length) {
    diagnostics.push(diagnostic(
      'error',
      'composition-filter-view-controls-component-conflict',
      'Явные .controls(...) относятся только ко встроенному генератору и не используются вместе с .component(...).',
      `runtimes.${name}`,
      raw,
    ))
  }
  return descriptor
}

function readFilterViewControls(
  node: t.ObjectExpression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): Record<string, FilterViewControlDefinition> {
  const controls: Record<string, FilterViewControlDefinition> = {}
  const supported = new Set<FilterViewControlType>(['Input', 'Textarea', 'Checkbox', 'Select'])

  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      diagnostics.push(diagnostic('error', 'composition-filter-view-control-property', 'controls допускает обычные properties.', sourcePath, property))
      continue
    }
    const key = propertyName(property.key)
    const expression = unwrapExpression(property.value)
    if (!key || !t.isCallExpression(expression) || !t.isIdentifier(expression.callee, { name: 'control' })) {
      diagnostics.push(diagnostic('error', 'composition-filter-view-control-shape', 'Control должен иметь вид control(type).', `${sourcePath}.${key ?? ''}`, property))
      continue
    }
    const type = readStringArgument(expression, 0) as FilterViewControlType | null
    if (!type || !supported.has(type)) {
      diagnostics.push(diagnostic('error', 'composition-filter-view-control-type', `Control type "${type ?? ''}" не поддерживается.`, `${sourcePath}.${key}`, expression))
      continue
    }
    controls[key] = { type }
  }

  return controls
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
    if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'fromData' })) {
      const ref = readStringArgument(expression, 0) ?? ''
      const dot = ref.indexOf('.')
      const data = dot > 0 ? ref.slice(0, dot) : ref
      const path = dot > 0 ? ref.slice(dot + 1) : ''
      if (!data)
        diagnostics.push(diagnostic('error', 'composition-binding-data', 'fromData(path) требует data alias.', `${sourcePath}.${key}`, expression))
      else
        bindings[key] = { kind: 'data', data, path }
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

function readHooks(
  node: t.ArrayExpression,
  runtimeNames: Set<string>,
  runtimes: CompositionRuntimeDescriptor[],
  diagnostics: DiagnosticDraft[],
): CompositionHook[] {
  const hooks: CompositionHook[] = []
  node.elements.forEach((element, index) => {
    if (!element || !t.isExpression(element))
      return
    const chain = memberChain(element)
    if (!chain || !t.isIdentifier(chain.base.callee)) {
      diagnostics.push(diagnostic('error', 'composition-hook-shape', 'Hook должен начинаться с onMount() или onChange(path).', `hooks.${index}`, element))
      return
    }
    const root = chain.base.callee.name
    if (root !== 'onMount' && root !== 'onChange') {
      diagnostics.push(diagnostic('error', 'composition-hook-kind', `Hook "${root}" не поддерживается.`, `hooks.${index}`, chain.base))
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
        diagnostics.push(diagnostic('error', 'composition-hook-method', `Hook method ".${modifier.name}" не поддерживается.`, `hooks.${index}`, modifier.call))
    }
    if (!target || !runtimeNames.has(target)) {
      diagnostics.push(diagnostic('error', 'composition-hook-target', `Hook target "${target}" не найден.`, `hooks.${index}`, element))
      return
    }
    if (runtimes.find(item => item.name === target)?.kind !== 'query') {
      diagnostics.push(diagnostic('error', 'composition-hook-target-kind', 'Hook v1 может запускать только Query runtime.', `hooks.${index}`, element))
      return
    }
    if (root === 'onMount') {
      hooks.push({ kind: 'mount', target })
      return
    }
    if (!Number.isInteger(debounceMs) || debounceMs < 0 || debounceMs > 60000) {
      diagnostics.push(diagnostic('error', 'composition-hook-debounce', 'debounce должен быть целым числом от 0 до 60000.', `hooks.${index}`, element))
      return
    }
    const path = readStringArgument(chain.base, 0) ?? ''
    const dot = path.indexOf('.')
    const runtime = dot > 0 ? path.slice(0, dot) : ''
    const output = dot > 0 ? path.slice(dot + 1) : ''
    if (!runtimeNames.has(runtime) || !output) {
      diagnostics.push(diagnostic('error', 'composition-hook-path', `onChange path "${path}" должен иметь вид runtime.output.`, `hooks.${index}`, chain.base))
      return
    }
    hooks.push({ kind: 'change', runtime, output, target, debounceMs })
  })
  return hooks
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

function validateBindingReferences(data: CompositionDataDescriptor[], runtimes: CompositionRuntimeDescriptor[], diagnostics: DiagnosticDraft[]): void {
  const dataByName = new Map(data.map(item => [item.name, item]))
  const runtimeByName = new Map(runtimes.map(runtime => [runtime.name, runtime]))
  for (const runtime of runtimes) {
    if (runtime.kind === 'filter-view') {
      const source = runtimeByName.get(runtime.identity)
      if (!source) {
        diagnostics.push(diagnostic(
          'error',
          'composition-filter-fields-source-missing',
          `filterView source runtime "${runtime.identity}" не найден.`,
          `runtimes.${runtime.name}`,
        ))
      }
      else if (source.kind !== 'filter') {
        diagnostics.push(diagnostic(
          'error',
          'composition-filter-fields-source-kind',
          `filterView source "${runtime.identity}" должен быть Filter runtime.`,
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
      if (binding.kind === 'data' && !dataByName.has(binding.data)) {
        diagnostics.push(diagnostic(
          'error',
          'composition-binding-data-missing',
          `fromData(...) ссылается на отсутствующий data alias "${binding.data}".`,
          `runtimes.${runtime.name}.withProps.${prop}`,
        ))
      }
    }
    for (const publication of runtime.storeTo) {
      if (dataByName.get(publication.data)?.kind !== 'store') {
        diagnostics.push(diagnostic(
          'error',
          'composition-store-to-kind',
          `storeTo(...) должен ссылаться на store data, получен "${dataByName.get(publication.data)?.kind ?? ''}".`,
          `runtimes.${runtime.name}.storeTo`,
        ))
      }
    }
  }
}

function validateRuntimeCycles(
  runtimes: CompositionRuntimeDescriptor[],
  hooks: CompositionHook[],
  diagnostics: DiagnosticDraft[],
): void {
  const edges = new Map<string, string[]>()
  for (const runtime of runtimes) {
    const propEdges = Object.values(runtime.props)
      .filter((binding): binding is Extract<CompositionBindingValue, { kind: 'output' | 'filter-fields' }> => binding.kind === 'output' || binding.kind === 'filter-fields')
      .map(binding => binding.runtime)
    edges.set(runtime.name, runtime.kind === 'filter-view'
      ? [runtime.identity, ...propEdges]
      : propEdges)
  }
  for (const hook of hooks) {
    if (hook.kind === 'change')
      edges.set(hook.target, [...(edges.get(hook.target) ?? []), hook.runtime])
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
      diagnostics.push(diagnostic('error', 'composition-binding-cycle', `Runtime bindings/hooks содержат цикл около "${runtime.name}".`, `runtimes.${runtime.name}`))
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

function readDataTarget(raw: t.CallExpression['arguments'][number] | undefined): string | null {
  if (!raw || !t.isExpression(raw))
    return null
  const expression = unwrapExpression(raw)
  return t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'data' })
    ? readStringArgument(expression, 0)
    : null
}

function readOutputReference(raw: t.Expression): string | null {
  const expression = unwrapExpression(raw)
  return t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'output' })
    ? readStringArgument(expression, 0)
    : null
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
