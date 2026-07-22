import type {
  CompositionActivationDescriptor,
  CompositionBindingValue,
  CompositionDataDescriptor,
  CompositionOutputDescriptor,
  CompositionHook,
  CompositionPreviewLiteral,
  CompositionPreviewProps,
  CompositionResourceDescriptor,
  CompositionRuntimeDescriptor,
  CompositionRuntimeGraph,
  CompositionRuntimeKind,
  CompositionScopeDescriptor,
  CompositionSourceCompileResult,
  CompositionSourceDocument,
} from '@/domain/types/source/composition-source.types'
import type {
  FilterViewControlDefinition,
  FilterViewControlType,
} from '@/domain/types/ui/filter-view.type'
import type { ProgramDiagnostic } from '@/domain/types/program/program.types'
import type { SourceFieldDefinition } from '@/domain/types/source/source-expression.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import {
  diagnostic,
  compileSourceExpression,
  propertyName,
  readStringArgument,
  unwrapExpression,
} from '@/model/services/source-engine/compilers/source-expression-compile'
import { compileSourceField } from '@/model/services/source-engine/compilers/source-field-compile'
import { compileProgramMetadataProperty } from '@/model/services/source-engine/compilers/source-metadata-compile'

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
    const activationValue = propertyValue(definition, 'activateOn')
    const propsValue = propertyValue(definition, 'props')
    const previewPropsValue = propertyValue(definition, 'previewProps')
    const dataValue = propertyValue(definition, 'data')
    const resourcesValue = propertyValue(definition, 'resources')
    const runtimesValue = propertyValue(definition, 'runtimes')
    const hooksValue = propertyValue(definition, 'hooks')
    const outputsValue = propertyValue(definition, 'outputs')
    const activation = activationValue ? readActivation(activationValue, diagnostics, 'activateOn') : null
    const dataNode = dataValue && t.isObjectExpression(dataValue) ? dataValue : null
    const resourcesNode = resourcesValue && t.isObjectExpression(resourcesValue) ? resourcesValue : null
    const runtimesNode = runtimesValue && t.isObjectExpression(runtimesValue) ? runtimesValue : null
    const hooksNode = hooksValue && t.isArrayExpression(hooksValue) ? hooksValue : null
    const outputsNode = outputsValue && t.isObjectExpression(outputsValue) ? outputsValue : null
    if (dataValue && !dataNode)
      diagnostics.push(diagnostic('error', 'composition-source-data-shape', 'data должен быть object literal.', 'data', dataValue))
    if (resourcesValue && !resourcesNode)
      diagnostics.push(diagnostic('error', 'composition-source-resources-shape', 'resources должен быть object literal.', 'resources', resourcesValue))
    if (runtimesValue && !runtimesNode)
      diagnostics.push(diagnostic('error', 'composition-source-runtimes-shape', 'runtimes должен быть object literal.', 'runtimes', runtimesValue))
    if (hooksValue && !hooksNode)
      diagnostics.push(diagnostic('error', 'composition-source-hooks-shape', 'hooks должен быть array literal.', 'hooks', hooksValue))
    if (outputsValue && !outputsNode)
      diagnostics.push(diagnostic('error', 'composition-source-outputs-shape', 'outputs должен быть object literal.', 'outputs', outputsValue))
    const props = propsValue ? readProps(propsValue, source, diagnostics) : []
    const previewProps = previewPropsValue
      ? readPreviewProps(previewPropsValue, new Set(props.map(prop => prop.key)), diagnostics)
      : null
    const data = dataNode ? readData(dataNode, diagnostics) : []
    const dataNames = new Set(data.map(item => item.name))
    const defaultActivation = activation ?? { mode: 'startup' as const }
    const resources = resourcesNode
      ? readResources(resourcesNode, 'scope_default', '', diagnostics, { value: 0 })
      : []
    const scopes: CompositionScopeDescriptor[] = [{
      name: 'scope_default',
      path: 'scope_default',
      parentPath: null,
      activationOverride: activation,
      effectiveActivation: defaultActivation,
      resources: resources.map(item => item.path),
      runtimes: [],
      children: [],
      sourceOrder: 0,
    }]
    const runtimes: CompositionRuntimeDescriptor[] = []
    const order = { value: resources.length + 1 }
    if (runtimesNode) {
      readRuntimes(
        runtimesNode,
        dataNames,
        diagnostics,
        runtimes,
        scopes,
        resources,
        '',
        'scope_default',
        defaultActivation,
        order,
      )
    }
    scopes[0].runtimes = runtimes.filter(item => item.scopePath === 'scope_default').map(item => item.path)
    scopes[0].children = scopes.filter(item => item.parentPath === 'scope_default').map(item => item.path)
    const runtimeNames = new Set(runtimes.map(item => item.name))
    const hooks = hooksNode
      ? readHooks(hooksNode, runtimeNames, new Set(props.map(prop => prop.key)), runtimes, diagnostics)
      : []
    const scopeNames = new Set(scopes.filter(item => item.path !== 'scope_default').map(item => item.path))
    const outputs = outputsNode ? readOutputs(outputsNode, runtimeNames, scopeNames, diagnostics) : []

    if (!runtimesNode)
      diagnostics.push(diagnostic('error', 'composition-source-runtimes-missing', 'defineComposition требует runtimes.', 'runtimes', definition))
    validatePersistKeys(runtimes, diagnostics)
    validateBindingReferences(props, data, runtimes, diagnostics)
    validateRuntimeCycles(runtimes, hooks, diagnostics)

    const document: CompositionSourceDocument = { activation, props, previewProps, data, resources, scopes, runtimes, hooks, outputs }
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
  const dataInputs = document.runtimes.flatMap(runtime => Object.entries(runtime.dataBindings ?? {}).map(([targetData, sourceData]) => ({
    targetRuntime: runtime.name,
    targetData,
    sourceData,
  })))
  const updates = document.hooks.flatMap((hook, index) => hook.kind === 'change'
    ? [{
        id: `hook:${index}:${formatChangeSource(hook.source)}->${hook.target}`,
        source: hook.source,
        targetRuntime: hook.target,
        updateKind: 'run' as const,
        debounceMs: hook.debounceMs,
      }]
    : [])
  const successes = document.hooks.flatMap((hook, index) => hook.kind === 'success'
    ? [{
        id: `hook:${index}:${hook.runtime}:success->${hook.target}`,
        sourceRuntime: hook.runtime,
        targetRuntime: hook.target,
        updateKind: 'run' as const,
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
  return { inputs, dataInputs, updates, successes, publications, mounts }
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
    if (name !== 'metadata' && name !== 'activateOn' && name !== 'props' && name !== 'previewProps' && name !== 'data' && name !== 'resources' && name !== 'runtimes' && name !== 'hooks' && name !== 'outputs')
      diagnostics.push(diagnostic('error', 'composition-source-property-unsupported', `Свойство "${name ?? ''}" не поддерживается Composition v1.`, name ?? 'defineComposition', property))
  }
}

function readProps(
  raw: t.Expression,
  source: string,
  diagnostics: DiagnosticDraft[],
): SourceFieldDefinition[] {
  const expression = unwrapExpression(raw)
  if (!t.isCallExpression(expression) || !t.isIdentifier(expression.callee, { name: 'defineProps' })) {
    diagnostics.push(diagnostic('error', 'composition-source-props-shape', 'props должен иметь вид defineProps({...}).', 'props', expression))
    return []
  }
  const definition = expression.arguments[0]
  if (!definition || !t.isObjectExpression(definition) || expression.arguments.length !== 1) {
    diagnostics.push(diagnostic('error', 'composition-source-props-definition', 'defineProps(...) принимает один object literal.', 'props', expression))
    return []
  }

  const props: SourceFieldDefinition[] = []
  const declared = new Set<string>()
  for (const property of definition.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      diagnostics.push(diagnostic('error', 'composition-prop-property', 'defineProps допускает только обычные properties.', 'props', property))
      continue
    }
    const key = propertyName(property.key)
    if (!key || declared.has(key)) {
      diagnostics.push(diagnostic('error', 'composition-prop-duplicate', `Prop "${key ?? ''}" объявлен повторно.`, `props.${key ?? ''}`, property))
      continue
    }
    declared.add(key)
    const compiled = compileSourceField(key, property.value, source, diagnostics, `props.${key}`)
    if (!compiled)
      continue
    if (compiled.defaultSource) {
      diagnostics.push(diagnostic(
        'error',
        'composition-prop-default-source-unsupported',
        'Composition prop не поддерживает field().from(...); используйте static .default(...).',
        `props.${key}.from`,
        property.value,
      ))
    }
    props.push(compiled.field)
  }
  return props
}

function readPreviewProps(
  raw: t.Expression,
  propNames: ReadonlySet<string>,
  diagnostics: DiagnosticDraft[],
): CompositionPreviewProps | null {
  const expression = unwrapExpression(raw)
  if (!t.isCallExpression(expression) || !t.isIdentifier(expression.callee, { name: 'definePreviewProps' })) {
    diagnostics.push(diagnostic('warning', 'composition-preview-props-shape', 'previewProps должен иметь вид definePreviewProps({...}).', 'previewProps', expression))
    return null
  }
  const definition = expression.arguments[0]
  if (!definition || !t.isObjectExpression(definition) || expression.arguments.length !== 1) {
    diagnostics.push(diagnostic('warning', 'composition-preview-props-definition', 'definePreviewProps(...) принимает один object literal с preview-значениями props.', 'previewProps', expression))
    return null
  }

  const previewProps: CompositionPreviewProps = {}
  const declared = new Set<string>()
  for (const property of definition.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      diagnostics.push(diagnostic('warning', 'composition-preview-prop-property', 'definePreviewProps допускает только обычные properties.', 'previewProps', property))
      continue
    }
    const key = propertyName(property.key)
    if (!key || declared.has(key)) {
      diagnostics.push(diagnostic('warning', 'composition-preview-prop-duplicate', `Preview prop "${key ?? ''}" объявлен повторно.`, `previewProps.${key ?? ''}`, property))
      continue
    }
    declared.add(key)
    if (!propNames.has(key)) {
      diagnostics.push(diagnostic('warning', 'composition-preview-prop-unknown', `Composition не объявляет prop "${key}". Preview-значение проигнорировано.`, `previewProps.${key}`, property))
      continue
    }

    const value = unwrapExpression(property.value)
    if (t.isCallExpression(value) && t.isIdentifier(value.callee, { name: 'mock' })) {
      const identity = readStringArgument(value, 0)
      if (!identity || value.arguments.length !== 1) {
        diagnostics.push(diagnostic('warning', 'composition-preview-prop-mock', 'mock(identity) требует одну непустую строку.', `previewProps.${key}`, value))
        continue
      }
      previewProps[key] = { kind: 'mock', identity }
      continue
    }

    const literal = staticValue(value)
    if (!literal.ok) {
      diagnostics.push(diagnostic('warning', 'composition-preview-prop-value', 'Preview prop принимает только static JSON value или mock(identity).', `previewProps.${key}`, value))
      continue
    }
    previewProps[key] = { kind: 'literal', value: literal.value as CompositionPreviewLiteral }
  }
  return previewProps
}

function readActivation(
  raw: t.Node | null | undefined,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): CompositionActivationDescriptor | null {
  const expression = raw && t.isExpression(raw) ? unwrapExpression(raw) : null
  if (!expression || !t.isCallExpression(expression) || !t.isIdentifier(expression.callee)) {
    diagnostics.push(diagnostic('error', 'composition-activation-shape', 'Activation должен иметь вид startup() или manual().', sourcePath, raw ?? undefined))
    return null
  }
  const mode = expression.callee.name
  if ((mode !== 'startup' && mode !== 'manual') || expression.arguments.length) {
    diagnostics.push(diagnostic('error', 'composition-activation-kind', 'Activation поддерживает только startup() или manual() без аргументов.', sourcePath, expression))
    return null
  }
  return { mode }
}

function validateScopeProperties(node: t.ObjectExpression, diagnostics: DiagnosticDraft[], path: string): void {
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed) {
      diagnostics.push(diagnostic('error', 'composition-scope-property', `Scope "${path}" допускает только обычные properties.`, `runtimes.${path}`, property))
      continue
    }
    const name = propertyName(property.key)
    if (name !== 'resources' && name !== 'runtimes')
      diagnostics.push(diagnostic('error', 'composition-scope-property-unsupported', `Свойство "${name ?? ''}" не поддерживается внутри scope.`, `runtimes.${path}.${name ?? ''}`, property))
  }
}

function readResources(
  node: t.ObjectExpression,
  scopePath: string,
  publicPrefix: string,
  diagnostics: DiagnosticDraft[],
  order: { value: number },
): CompositionResourceDescriptor[] {
  const resources: CompositionResourceDescriptor[] = []
  const declared = new Set<string>()
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      diagnostics.push(diagnostic('error', 'composition-resource-property', 'resources допускает только обычные properties.', 'resources', property))
      continue
    }
    const name = propertyName(property.key)
    const expression = unwrapExpression(property.value)
    const path = publicPrefix ? `${publicPrefix}.${name ?? ''}` : String(name ?? '')
    if (!name || declared.has(name)) {
      diagnostics.push(diagnostic('error', 'composition-resource-duplicate', `Resource "${name ?? ''}" объявлен повторно.`, `resources.${path}`, property))
      continue
    }
    declared.add(name)
    if (!t.isCallExpression(expression) || !t.isIdentifier(expression.callee, { name: 'style' })) {
      diagnostics.push(diagnostic('error', 'composition-resource-kind', `Resource "${path}" должен иметь вид style(identity).`, `resources.${path}`, expression))
      continue
    }
    const identity = readStringArgument(expression, 0)
    if (!identity || expression.arguments.length !== 1) {
      diagnostics.push(diagnostic('error', 'composition-resource-style-identity', `Style resource "${path}" требует один identity.`, `resources.${path}`, expression))
      continue
    }
    resources.push({
      name,
      path,
      scopePath,
      kind: 'style',
      identity,
      sourceOrder: order.value++,
    })
  }
  return resources
}

function readData(node: t.ObjectExpression, diagnostics: DiagnosticDraft[]): CompositionDataDescriptor[] {
  const data: CompositionDataDescriptor[] = []
  const declared = new Set<string>()
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value))
      continue
    const name = propertyName(property.key)
    const chain = memberChain(property.value)
    if (!name || !chain || !t.isIdentifier(chain.base.callee)) {
      diagnostics.push(diagnostic('error', 'composition-data-shape', 'data entry должен быть store(identity) или vocab(identity).', `data.${name ?? ''}`, property))
      continue
    }
    if (declared.has(name)) {
      diagnostics.push(diagnostic('error', 'composition-data-duplicate', `Data alias "${name}" объявлен повторно.`, `data.${name}`, property))
      continue
    }
    const kind = chain.base.callee.name
    if (kind !== 'store' && kind !== 'vocab') {
      diagnostics.push(diagnostic('error', 'composition-data-kind', `Data kind "${kind}" не поддерживается.`, `data.${name}`, chain.base))
      continue
    }
    const identity = readStringArgument(chain.base, 0)
    if (!identity) {
      diagnostics.push(diagnostic('error', 'composition-data-identity', `Data "${name}" требует identity.`, `data.${name}`, chain.base))
      continue
    }

    let resolution: CompositionDataDescriptor['resolution'] = kind === 'store' ? 'contextual' : undefined
    let slot: string | null = null
    const resolutionModifiers = chain.modifiers.filter(item => ['contextual', 'isolated', 'injected'].includes(item.name))
    if (resolutionModifiers.length > 1) {
      diagnostics.push(diagnostic(
        'error',
        'composition-data-resolution-conflict',
        `Store data "${name}" имеет несколько resolution modifiers.`,
        `data.${name}`,
        resolutionModifiers[1]?.call,
      ))
    }
    for (const modifier of chain.modifiers) {
      if (kind !== 'store') {
        diagnostics.push(diagnostic('error', 'composition-data-modifier-kind', `.${modifier.name}(...) поддерживается только для store(...).`, `data.${name}`, modifier.call))
        continue
      }
      if (modifier.name === 'contextual' || modifier.name === 'isolated' || modifier.name === 'injected') {
        if (modifier.call.arguments.length) {
          diagnostics.push(diagnostic('error', 'composition-data-resolution-arguments', `.${modifier.name}() не принимает аргументы.`, `data.${name}.${modifier.name}`, modifier.call))
          continue
        }
        if (resolutionModifiers.length === 1)
          resolution = modifier.name
        continue
      }
      if (modifier.name === 'slot') {
        const value = readStringArgument(modifier.call, 0)
        if (!value || modifier.call.arguments.length !== 1)
          diagnostics.push(diagnostic('error', 'composition-data-slot', '.slot(name) требует одну непустую строку.', `data.${name}.slot`, modifier.call))
        else if (slot)
          diagnostics.push(diagnostic('error', 'composition-data-slot-duplicate', '.slot(name) объявлен повторно.', `data.${name}.slot`, modifier.call))
        else
          slot = value
        continue
      }
      diagnostics.push(diagnostic('error', 'composition-data-method', `.${modifier.name}(...) не поддерживается Store data descriptor.`, `data.${name}`, modifier.call))
    }

    data.push({ name, kind, identity, ...(resolution ? { resolution } : {}), ...(slot ? { slot } : {}) })
    declared.add(name)
  }
  return data
}

function readRuntimes(
  node: t.ObjectExpression,
  dataNames: Set<string>,
  diagnostics: DiagnosticDraft[],
  runtimes: CompositionRuntimeDescriptor[],
  scopes: CompositionScopeDescriptor[],
  resources: CompositionResourceDescriptor[],
  publicPrefix: string,
  ownerScopePath: string,
  ownerActivation: CompositionActivationDescriptor,
  order: { value: number },
): void {
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
      diagnostics.push(diagnostic('error', 'composition-runtime-duplicate', `Runtime или scope "${name}" объявлен повторно.`, `runtimes.${name}`, property))
      continue
    }
    declared.add(name)
    const chain = memberChain(property.value)
    if (chain && t.isIdentifier(chain.base.callee, { name: 'scope' })) {
      const path = publicPrefix ? `${publicPrefix}.${name}` : name
      const definition = chain.base.arguments[0]
      if (!definition || !t.isObjectExpression(definition)) {
        diagnostics.push(diagnostic('error', 'composition-scope-shape', `Scope "${path}" должен иметь вид scope({ resources, runtimes }).`, `runtimes.${path}`, property.value))
        continue
      }
      let activationOverride: CompositionActivationDescriptor | null = null
      for (const modifier of chain.modifiers) {
        if (modifier.name !== 'activateOn') {
          diagnostics.push(diagnostic('error', 'composition-scope-method', `Scope method ".${modifier.name}" не поддерживается.`, `runtimes.${path}`, modifier.call))
          continue
        }
        activationOverride = readActivation(modifier.call.arguments[0], diagnostics, `runtimes.${path}.activateOn`)
      }
      validateScopeProperties(definition, diagnostics, path)
      const effectiveActivation = activationOverride ?? ownerActivation
      const scopeResourcesNode = propertyValue(definition, 'resources')
      const scopeRuntimesNode = propertyValue(definition, 'runtimes')
      if (scopeResourcesNode && !t.isObjectExpression(scopeResourcesNode))
        diagnostics.push(diagnostic('error', 'composition-scope-resources-shape', `resources scope "${path}" должен быть object literal.`, `runtimes.${path}.resources`, scopeResourcesNode))
      if (scopeRuntimesNode && !t.isObjectExpression(scopeRuntimesNode))
        diagnostics.push(diagnostic('error', 'composition-scope-runtimes-shape', `runtimes scope "${path}" должен быть object literal.`, `runtimes.${path}.runtimes`, scopeRuntimesNode))
      const ownedResources = t.isObjectExpression(scopeResourcesNode)
        ? readResources(scopeResourcesNode, path, path, diagnostics, order)
        : []
      resources.push(...ownedResources)
      const scope: CompositionScopeDescriptor = {
        name,
        path,
        parentPath: ownerScopePath,
        activationOverride,
        effectiveActivation,
        resources: ownedResources.map(item => item.path),
        runtimes: [],
        children: [],
        sourceOrder: order.value++,
      }
      scopes.push(scope)
      if (t.isObjectExpression(scopeRuntimesNode)) {
        readRuntimes(
          scopeRuntimesNode,
          dataNames,
          diagnostics,
          runtimes,
          scopes,
          resources,
          path,
          path,
          effectiveActivation,
          order,
        )
      }
      scope.runtimes = runtimes.filter(item => item.scopePath === path).map(item => item.path)
      scope.children = scopes.filter(item => item.parentPath === path).map(item => item.path)
      continue
    }
    const path = publicPrefix ? `${publicPrefix}.${name}` : name
    const runtime = readRuntime(path, property.value, dataNames, diagnostics, ownerScopePath, ownerActivation)
    if (runtime)
      runtimes.push(runtime)
  }
}

function readRuntime(
  name: string,
  raw: t.Expression,
  dataNames: Set<string>,
  diagnostics: DiagnosticDraft[],
  scopePath: string,
  ownerActivation: CompositionActivationDescriptor,
): CompositionRuntimeDescriptor | null {
  const chain = memberChain(raw)
  if (!chain || !t.isIdentifier(chain.base.callee)) {
    diagnostics.push(diagnostic('error', 'composition-runtime-shape', `Runtime "${name}" должен начинаться с filter/query/component/composition/filterView(identity).`, `runtimes.${name}`, raw))
    return null
  }

  const rawKind = chain.base.callee.name
  const kind = (rawKind === 'filterView' ? 'filter-view' : rawKind) as CompositionRuntimeKind
  if (kind !== 'filter' && kind !== 'query' && kind !== 'component' && kind !== 'composition' && kind !== 'filter-view') {
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
    path: name,
    scopePath,
    sourceLocations: {
      runtime: sourceRange(raw),
      call: sourceRange(chain.base),
      withProps: null,
    },
    kind,
    identity,
    activationOverride: null,
    effectiveActivation: ownerActivation,
    props: {},
    dataBindings: {},
    storeTo: [],
  }

  for (const modifier of chain.modifiers) {
    if (modifier.name === 'activateOn') {
      descriptor.activationOverride = readActivation(modifier.call.arguments[0], diagnostics, `runtimes.${name}.activateOn`)
      descriptor.effectiveActivation = descriptor.activationOverride ?? ownerActivation
      continue
    }
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
        diagnostics.push(diagnostic(
          'error',
          'composition-filter-props-unsupported',
          'Filter runtime v1 не принимает .withProps(...).',
          `runtimes.${name}.withProps`,
          modifier.call,
        ))
        continue
      }
      const config = modifier.call.arguments[0]
      if (!config || !t.isObjectExpression(config)) {
        diagnostics.push(diagnostic('error', 'composition-props-object', '.withProps(...) принимает object literal.', `runtimes.${name}.withProps`, modifier.call))
        continue
      }
      descriptor.sourceLocations!.withProps = sourceRange(config)
      descriptor.props = readBindings(config, diagnostics, `runtimes.${name}.withProps`)
      continue
    }
    if (modifier.name === 'withData') {
      if (kind !== 'composition') {
        diagnostics.push(diagnostic('error', 'composition-with-data-runtime-kind', '.withData(...) поддерживается только для вложенной Composition.', `runtimes.${name}.withData`, modifier.call))
        continue
      }
      const config = modifier.call.arguments[0]
      if (!config || !t.isObjectExpression(config)) {
        diagnostics.push(diagnostic('error', 'composition-with-data-object', '.withData(...) принимает object literal.', `runtimes.${name}.withData`, modifier.call))
        continue
      }
      descriptor.dataBindings = readDataBindings(config, dataNames, diagnostics, `runtimes.${name}.withData`)
      continue
    }
    if (modifier.name === 'storeTo') {
      if (kind !== 'query' && kind !== 'composition') {
        diagnostics.push(diagnostic('error', 'composition-store-to-runtime-kind', '.storeTo(...) поддерживается только Query и Composition runtime.', `runtimes.${name}.storeTo`, modifier.call))
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
          diagnostics.push(diagnostic('error', 'composition-store-to-field', 'storeTo mapping имеет вид { storeField: output(runtimeOutput) }.', `runtimes.${name}.storeTo`, property))
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

function readDataBindings(
  node: t.ObjectExpression,
  dataNames: Set<string>,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): Record<string, string> {
  const bindings: Record<string, string> = {}
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      diagnostics.push(diagnostic('error', 'composition-with-data-property', 'withData допускает только обычные properties.', sourcePath, property))
      continue
    }
    const targetData = propertyName(property.key)
    const sourceData = readDataTarget(property.value)
    if (!targetData || !sourceData) {
      diagnostics.push(diagnostic('error', 'composition-with-data-binding', 'withData mapping имеет вид { childAlias: data(parentAlias) }.', `${sourcePath}.${targetData ?? ''}`, property))
      continue
    }
    if (!dataNames.has(sourceData)) {
      diagnostics.push(diagnostic('error', 'composition-with-data-source-missing', `withData ссылается на отсутствующий data alias "${sourceData}".`, `${sourcePath}.${targetData}`, property))
      continue
    }
    bindings[targetData] = sourceData
  }
  return bindings
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
      if (!runtime || expression.arguments.length < 1 || expression.arguments.length > 2 || (expression.arguments.length === 2 && !output)) {
        diagnostics.push(diagnostic('error', 'composition-binding-output', 'fromOutput(runtime[, output]) требует одну или две непустые строки.', `${sourcePath}.${key}`, expression))
      }
      else {
        bindings[key] = output
          ? { kind: 'output', runtime, output }
          : { kind: 'outputs', runtime }
      }
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
    if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'metadataOf' })) {
      const runtime = readStringArgument(expression, 0)
      const namespace = readStringArgument(expression, 1)
      if (!runtime || expression.arguments.length < 1 || expression.arguments.length > 2 || (expression.arguments.length === 2 && !namespace)) {
        diagnostics.push(diagnostic('error', 'composition-binding-runtime-metadata', 'metadataOf(runtime[, namespace]) требует одну или две непустые строки.', `${sourcePath}.${key}`, expression))
      }
      else {
        bindings[key] = namespace
          ? { kind: 'runtime-metadata', runtime, namespace }
          : { kind: 'runtime-metadata', runtime }
      }
      continue
    }
    const filterBinding = readFilterFieldsBinding(expression, diagnostics, `${sourcePath}.${key}`)
    if (filterBinding) {
      bindings[key] = filterBinding
      continue
    }

    const value = staticValue(expression)
    if (value.ok)
      bindings[key] = { kind: 'literal', value: value.value }
    else {
      const compiled = compileSourceExpression(expression, diagnostics, `${sourcePath}.${key}`)
      if (compiled)
        bindings[key] = { kind: 'expression', expression: compiled }
    }
  }
  return bindings
}

function readHooks(
  node: t.ArrayExpression,
  runtimeNames: Set<string>,
  propNames: Set<string>,
  runtimes: CompositionRuntimeDescriptor[],
  diagnostics: DiagnosticDraft[],
): CompositionHook[] {
  const hooks: CompositionHook[] = []
  node.elements.forEach((element, index) => {
    if (!element || !t.isExpression(element))
      return
    const chain = memberChain(element)
    if (!chain || !t.isIdentifier(chain.base.callee)) {
      diagnostics.push(diagnostic('error', 'composition-hook-shape', 'Hook должен начинаться с onMount(), onChange(path) или onSuccess(runtime).', `hooks.${index}`, element))
      return
    }
    const root = chain.base.callee.name
    if (root !== 'onMount' && root !== 'onChange' && root !== 'onSuccess') {
      diagnostics.push(diagnostic('error', 'composition-hook-kind', `Hook "${root}" не поддерживается.`, `hooks.${index}`, chain.base))
      return
    }
    let target = ''
    let debounceMs = 200
    for (const modifier of chain.modifiers) {
      if (modifier.name === 'run')
        target = readStringArgument(modifier.call, 0) ?? ''
      else if (modifier.name === 'debounce') {
        if (root !== 'onChange') {
          diagnostics.push(diagnostic('error', 'composition-hook-debounce-kind', '.debounce(...) поддерживается только для onChange.', `hooks.${index}`, modifier.call))
          continue
        }
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
      if (runtimes.find(item => item.name === target)?.effectiveActivation.mode === 'manual') {
        diagnostics.push(diagnostic('error', 'composition-hook-manual-target', `onMount не может запускать manual runtime "${target}". Добавьте .activateOn(startup()) или активируйте runtime через API.`, `hooks.${index}`, element))
        return
      }
      hooks.push({ kind: 'mount', target })
      return
    }
    if (root === 'onSuccess') {
      const runtime = readStringArgument(chain.base, 0) ?? ''
      const source = runtimes.find(item => item.name === runtime)
      if (!source) {
        diagnostics.push(diagnostic('error', 'composition-hook-success-source', `onSuccess source "${runtime}" не найден.`, `hooks.${index}`, chain.base))
        return
      }
      if (source.kind !== 'query') {
        diagnostics.push(diagnostic('error', 'composition-hook-success-source-kind', 'onSuccess может наблюдать только Query runtime.', `hooks.${index}`, chain.base))
        return
      }
      hooks.push({ kind: 'success', runtime, target })
      return
    }
    if (!Number.isInteger(debounceMs) || debounceMs < 0 || debounceMs > 60000) {
      diagnostics.push(diagnostic('error', 'composition-hook-debounce', 'debounce должен быть целым числом от 0 до 60000.', `hooks.${index}`, element))
      return
    }
    const source = readChangeSource(chain.base, runtimeNames, propNames, diagnostics, `hooks.${index}`)
    if (source)
      hooks.push({ kind: 'change', source, target, debounceMs })
  })
  return hooks
}

/** Разбирает поддерживаемый источник onChange без расширения hooks до произвольных выражений. */
function readChangeSource(
  call: t.CallExpression,
  runtimeNames: Set<string>,
  propNames: Set<string>,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): Extract<CompositionHook, { kind: 'change' }>['source'] | null {
  const argument = call.arguments[0]
  if (call.arguments.length !== 1 || !argument || !t.isExpression(argument)) {
    diagnostics.push(diagnostic('error', 'composition-hook-change-source', 'onChange принимает runtime.output или prop(path).', sourcePath, call))
    return null
  }

  const expression = unwrapExpression(argument)
  if (t.isStringLiteral(expression)) {
    const dot = expression.value.indexOf('.')
    const runtime = dot > 0 ? expression.value.slice(0, dot) : ''
    const output = dot > 0 ? expression.value.slice(dot + 1) : ''
    if (!runtimeNames.has(runtime) || !output) {
      diagnostics.push(diagnostic('error', 'composition-hook-path', `onChange path "${expression.value}" должен иметь вид runtime.output.`, sourcePath, call))
      return null
    }
    return { kind: 'runtime-output', runtime, output }
  }

  if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'prop' })) {
    const path = readStringArgument(expression, 0) ?? ''
    const root = path.split('.')[0]
    if (expression.arguments.length !== 1 || !path) {
      diagnostics.push(diagnostic('error', 'composition-hook-prop-path', 'onChange(prop(path)) требует один непустой строковый path.', sourcePath, expression))
      return null
    }
    if (!propNames.has(root)) {
      diagnostics.push(diagnostic('error', 'composition-hook-prop-missing', `onChange(prop(...)) ссылается на необъявленный Composition prop "${root}".`, sourcePath, expression))
      return null
    }
    return { kind: 'prop', path }
  }

  diagnostics.push(diagnostic('error', 'composition-hook-change-source', 'onChange принимает runtime.output или prop(path).', sourcePath, argument))
  return null
}

function formatChangeSource(source: Extract<CompositionHook, { kind: 'change' }>['source']): string {
  return source.kind === 'runtime-output'
    ? `${source.runtime}.${source.output}`
    : `prop(${source.path})`
}

function readOutputs(
  node: t.ObjectExpression,
  runtimeNames: Set<string>,
  scopeNames: Set<string>,
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
    let scope = ''
    let selected: string | undefined
    for (const modifier of chain.modifiers) {
      if (modifier.name === 'fromRuntime')
        runtime = readStringArgument(modifier.call, 0) ?? ''
      else if (modifier.name === 'fromScope')
        scope = readStringArgument(modifier.call, 0) ?? ''
      else if (modifier.name === 'select')
        selected = readStringArgument(modifier.call, 0) ?? undefined
      else
        diagnostics.push(diagnostic('error', 'composition-output-method', `Output method ".${modifier.name}" не поддерживается.`, `outputs.${key}`, modifier.call))
    }
    if (runtime && scope) {
      diagnostics.push(diagnostic('error', 'composition-output-target-conflict', `Output "${key}" не может одновременно ссылаться на runtime и scope.`, `outputs.${key}`, property.value))
      continue
    }
    if (scope) {
      if (selected) {
        diagnostics.push(diagnostic('error', 'composition-output-scope-select', `Scope output "${key}" не поддерживает .select(...).`, `outputs.${key}`, property.value))
        continue
      }
      if (!scopeNames.has(scope)) {
        diagnostics.push(diagnostic('error', 'composition-output-scope', `Scope "${scope}" не найден.`, `outputs.${key}`, property.value))
        continue
      }
      outputs.push({ key, kind: 'scope', scope })
      continue
    }
    if (!runtimeNames.has(runtime)) {
      diagnostics.push(diagnostic('error', 'composition-output-runtime', `Runtime "${runtime}" не найден.`, `outputs.${key}`, property.value))
      continue
    }
    outputs.push({ key, kind: 'runtime', runtime, output: selected })
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

function validateBindingReferences(
  props: SourceFieldDefinition[],
  data: CompositionDataDescriptor[],
  runtimes: CompositionRuntimeDescriptor[],
  diagnostics: DiagnosticDraft[],
): void {
  const propNames = new Set(props.map(prop => prop.key))
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
      if (binding.kind === 'expression') {
        for (const read of collectExpressionReads(binding.expression)) {
          const runtimeRef = read.source === 'composition-output' || read.source === 'composition-outputs' || read.source === 'composition-filter-fields' || read.source === 'composition-runtime-metadata'
            ? read.parameters?.[0]
            : undefined
          const dataRef = read.source === 'composition-data'
            ? String(read.parameters?.[0] ?? '').split('.')[0]
            : undefined
          const propRef = read.source === 'prop'
            ? read.path.split('.')[0]
            : undefined
          if (runtimeRef && !runtimeByName.has(runtimeRef))
            diagnostics.push(diagnostic('error', 'composition-binding-runtime-missing', `Expression ссылается на отсутствующий runtime "${runtimeRef}".`, `runtimes.${runtime.name}.withProps.${prop}`))
          if (read.source === 'composition-filter-fields' && runtimeRef && runtimeByName.get(runtimeRef)?.kind !== 'filter')
            diagnostics.push(diagnostic('error', 'composition-binding-filter-runtime-kind', `fromFilter(...) должен ссылаться на Filter runtime, получен "${runtimeByName.get(runtimeRef)?.kind ?? ''}".`, `runtimes.${runtime.name}.withProps.${prop}`))
          if (dataRef && !dataByName.has(dataRef))
            diagnostics.push(diagnostic('error', 'composition-binding-data-missing', `Expression ссылается на отсутствующий data alias "${dataRef}".`, `runtimes.${runtime.name}.withProps.${prop}`))
          if (propRef && !propNames.has(propRef))
            diagnostics.push(diagnostic('error', 'composition-binding-prop-missing', `prop(...) ссылается на необъявленный Composition prop "${propRef}".`, `runtimes.${runtime.name}.withProps.${prop}`))
        }
      }
      if ((binding.kind === 'output' || binding.kind === 'outputs' || binding.kind === 'filter-fields') && !runtimeByName.has(binding.runtime)) {
        diagnostics.push(diagnostic(
          'error',
          'composition-binding-runtime-missing',
          `Binding ссылается на отсутствующий runtime "${binding.runtime}".`,
          `runtimes.${runtime.name}.withProps.${prop}`,
        ))
      }
      if (binding.kind === 'runtime-metadata' && !runtimeByName.has(binding.runtime)) {
        diagnostics.push(diagnostic(
          'error',
          'composition-binding-runtime-missing',
          `metadataOf(...) ссылается на отсутствующий runtime "${binding.runtime}".`,
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
      .flatMap((binding) => {
        if (binding.kind === 'output' || binding.kind === 'outputs' || binding.kind === 'filter-fields')
          return [binding.runtime]
        if (binding.kind === 'expression')
          return collectExpressionReads(binding.expression)
            .filter(read => read.source === 'composition-output' || read.source === 'composition-outputs' || read.source === 'composition-filter-fields')
            .map(read => read.parameters?.[0])
            .filter((value): value is string => Boolean(value))
        return []
      })
    edges.set(runtime.name, runtime.kind === 'filter-view'
      ? [runtime.identity, ...propEdges]
      : propEdges)
  }
  for (const hook of hooks) {
    if (hook.kind === 'success')
      edges.set(hook.target, [...(edges.get(hook.target) ?? []), hook.runtime])
    else if (hook.kind === 'change' && hook.source.kind === 'runtime-output')
      edges.set(hook.target, [...(edges.get(hook.target) ?? []), hook.source.runtime])
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

function collectExpressionReads(expression: import('@/domain/types/source/source-expression.types').SourceExpressionIR): Array<Extract<import('@/domain/types/source/source-expression.types').SourceExpressionIR, { type: 'read' }>> {
  if (expression.type === 'read')
    return [expression]
  if (expression.type === 'operation')
    return expression.arguments.flatMap(collectExpressionReads)
  if (expression.type === 'array')
    return expression.items.flatMap(collectExpressionReads)
  if (expression.type === 'object')
    return Object.values(expression.properties).flatMap(collectExpressionReads)
  return []
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

function sourceRange(node: t.Node): { start: number, end: number } {
  const start = Math.max(0, Number(node.start ?? 0))
  return {
    start,
    end: Math.max(start, Number(node.end ?? start)),
  }
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
