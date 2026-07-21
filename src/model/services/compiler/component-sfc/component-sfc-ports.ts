import { parse as parseTS } from '@babel/parser'

import type { RComponentDependencies, RComponentDiagnostic } from '@/domain/types/component/component-core.types'
import type { TypeSourceDefinition } from '@/domain/types/source/type-source.types'
import type {
  ComponentSFCComponentPort,
  ComponentSFCComputationPort,
  ComponentSFCActionPort,
  ComponentSFCEventPort,
  ComponentSFCEventAction,
  ComponentSFCEventInputValue,
  ComponentSFCPortForwardRule,
  ComponentSFCPortForwardSelector,
  ComponentSFCPortRole,
  ComponentSFCPortManifest,
  ComponentSFCPortProviderDescriptor,
  RComponentSFC_AST_Script,
  RComponentSFC_IR_PortCall,
} from '@/domain/types/component/sfc'
import { createEmptyComponentSFCPortManifest } from '@/domain/types/component/sfc'
import { compileComponentSFCExpression } from '@/model/services/compiler/component-sfc/component-sfc-expression'
import { parseComponentSFCTypeFields } from '@/model/services/compiler/component-sfc/component-sfc-script'
import { isComponentSFCBuiltInTag } from '@/model/services/compiler/component-sfc/component-sfc-template'

export interface ComponentSFCPortAnalysisOptions {
  resolveProvider?: (
    identity: string,
    expectedKind: 'computation' | 'component' | 'action',
  ) => ComponentSFCPortProviderDescriptor | null
  resolveTypeDefinition?: (identity: string) => TypeSourceDefinition | null
}

export interface ComponentSFCPortAnalysisResult {
  manifest: ComponentSFCPortManifest
  calls: RComponentSFC_IR_PortCall[]
  dependencies: RComponentDependencies
  diagnostics: RComponentDiagnostic[]
  bindingName: string | null
}

/** Parses `definePorts` and top-level computation port locals from script setup. */
export function analyzeComponentSFCPorts(
  script: RComponentSFC_AST_Script | null,
  dependencies: RComponentDependencies,
  options: ComponentSFCPortAnalysisOptions = {},
): ComponentSFCPortAnalysisResult {
  const manifest = createEmptyComponentSFCPortManifest()
  const calls: RComponentSFC_IR_PortCall[] = []
  const diagnostics: RComponentDiagnostic[] = []
  if (!script) return { manifest, calls, dependencies, diagnostics, bindingName: null }

  let ast: any
  try {
    ast = parseTS(script.content, {
      sourceType: 'module',
      plugins: ['typescript'],
    }) as any
  }
  catch {
    return { manifest, calls, dependencies, diagnostics, bindingName: null }
  }

  const declarations: Array<{ statement: any, declaration: any }> = []
  for (const statement of ast.program.body ?? []) {
    if (statement.type !== 'VariableDeclaration') continue
    for (const declaration of statement.declarations ?? []) {
      if (isCall(declaration.init, 'definePorts'))
        declarations.push({ statement, declaration })
    }
  }

  const topLevelDefinePorts = new Set(declarations.map(item => item.declaration.init?.start))
  walkBabelNodes(ast.program.body ?? [], (node) => {
    if (isCall(node, 'definePorts') && !topLevelDefinePorts.has(node.start)) {
      diagnostics.push(makeDiagnostic(
        'sfc-ports-top-level-required',
        'definePorts допускается только в top-level `const ports = definePorts({...})`.',
        node,
        script,
      ))
    }
  })

  if (declarations.length > 1) {
    diagnostics.push(makeDiagnostic(
      'sfc-ports-duplicate',
      'SFC допускает только один top-level `const ports = definePorts({...})`.',
      declarations[1]!.statement,
      script,
    ))
  }

  const portsDeclaration = declarations[0]
  const bindingName = portsDeclaration?.declaration.id?.type === 'Identifier'
    ? portsDeclaration.declaration.id.name
    : null
  if (portsDeclaration) {
    if (portsDeclaration.statement.kind !== 'const' || bindingName !== 'ports') {
      diagnostics.push(makeDiagnostic(
        'sfc-ports-declaration-shape',
        'Ports v1 должны объявляться как `const ports = definePorts({...})`.',
        portsDeclaration.statement,
        script,
      ))
    }
    parsePortManifest(
      portsDeclaration.declaration.init,
      script,
      manifest,
      dependencies,
      diagnostics,
      options,
    )
  }

  if (bindingName) {
    parsePortCalls(
      ast.program.body ?? [],
      bindingName,
      script,
      manifest,
      calls,
      diagnostics,
      options,
    )
  }

  return { manifest, calls, dependencies, diagnostics, bindingName }
}

function parsePortManifest(
  call: any,
  script: RComponentSFC_AST_Script,
  manifest: ComponentSFCPortManifest,
  dependencies: RComponentDependencies,
  diagnostics: RComponentDiagnostic[],
  options: ComponentSFCPortAnalysisOptions,
): void {
  const object = call.arguments?.[0]
  if (call.arguments?.length !== 1 || object?.type !== 'ObjectExpression') {
    diagnostics.push(makeDiagnostic(
      'sfc-ports-object-required',
      'definePorts принимает ровно один object literal.',
      call,
      script,
    ))
    return
  }

  const roles = new Map<string, any>()
  let hasForward = false
  for (const property of object.properties ?? []) {
    if (property.type !== 'ObjectProperty' || property.computed) {
      diagnostics.push(makeDiagnostic(
        'sfc-port-property-shape',
        'Секция definePorts должна быть обычным object property без spread/computed key.',
        property,
        script,
      ))
      continue
    }
    const role = readKey(property.key)
    if (role === 'request') {
      diagnostics.push(makeDiagnostic(
        'sfc-port-request-renamed',
        'Секция definePorts.request переименована в definePorts.require.',
        property,
        script,
      ))
      continue
    }
    if (role === 'forward') {
      if (hasForward) {
        diagnostics.push(makeDiagnostic(
          'sfc-port-forward-duplicate',
          'definePorts допускает только одно поле forward.',
          property,
          script,
        ))
        continue
      }
      hasForward = true
      parseForwardDefinition(property.value, property, script, manifest, diagnostics)
      continue
    }
    if (!role || !['require', 'provides', 'emits'].includes(role) || roles.has(role)) {
      diagnostics.push(makeDiagnostic(
        'sfc-port-role-invalid',
        `definePorts поддерживает только уникальные секции require, provides, emits и forward; получено "${role ?? ''}".`,
        property,
        script,
      ))
      continue
    }
    if (property.value?.type !== 'ObjectExpression') {
      diagnostics.push(makeDiagnostic(
        'sfc-port-role-object-required',
        `Секция definePorts.${role} должна быть object literal.`,
        property.value,
        script,
      ))
      continue
    }
    roles.set(role, property.value)
  }

  const names = new Set<string>()
  const tags = new Set<string>()
  for (const role of ['require', 'provides', 'emits'] as const) {
    const roleObject = roles.get(role)
    if (!roleObject) continue

    for (const property of roleObject.properties ?? []) {
      if (property.type !== 'ObjectProperty' || property.computed) {
        diagnostics.push(makeDiagnostic(
          'sfc-port-property-shape',
          `Port в definePorts.${role} должен быть обычным property.`,
          property,
          script,
        ))
        continue
      }
      const name = readKey(property.key)
      if (!name || names.has(name)) {
        diagnostics.push(makeDiagnostic(
          'sfc-port-name-invalid',
          `Port name "${name ?? ''}" отсутствует или повторяется.`,
          property,
          script,
        ))
        continue
      }
      names.add(name)

      const definition = property.value
      const kind = isCall(definition, 'computation')
        ? 'computation'
        : isCall(definition, 'component')
          ? 'component'
          : isCall(definition, 'action')
            ? 'action'
            : isCall(definition, 'event')
              ? 'event'
              : null
      const allowed = role === 'require'
        ? ['computation', 'component', 'action']
        : role === 'provides'
          ? ['action']
          : ['event']
      if (!kind || !allowed.includes(kind)) {
        diagnostics.push(makeDiagnostic(
          'sfc-port-kind-unsupported',
          `Port "${name}" недопустим в definePorts.${role}. Разрешены: ${allowed.join(', ')}.`,
          definition,
          script,
        ))
        continue
      }

      const typeSources = readTypeParameters(definition, script.content)
      if (kind === 'event') {
        if ((definition.arguments?.length ?? 0) > 1 || typeSources.length > 1) {
          diagnostics.push(makeDiagnostic(
            'sfc-event-port-shape',
            `Event port "${name}" объявляется как event<Payload>() или event<Payload>({ from, action }).`,
            definition,
            script,
          ))
          continue
        }
        const config = definition.arguments?.[0]
        if (config && config.type !== 'ObjectExpression') {
          diagnostics.push(makeDiagnostic(
            'sfc-event-port-config',
            `Event port "${name}" принимает только object literal config.`,
            config,
            script,
          ))
          continue
        }
        const port: ComponentSFCEventPort = {
          kind,
          role: 'emits',
          name,
          payloadType: typeSources[0] ?? 'void',
          sourceRange: toRange(property, script),
        }
        if (config) {
          const parsed = parseEventConfig(name, config, script, dependencies, diagnostics)
          if (!parsed.valid) continue
          port.from = parsed.from
          port.action = parsed.action
        }
        manifest.emits.events.push(port)
        continue
      }

      if (kind === 'action' && role === 'provides') {
        if ((definition.arguments?.length ?? 0) !== 0 || typeSources.length !== 2) {
          diagnostics.push(makeDiagnostic(
            'sfc-provided-action-port-shape',
            `Provided Action port "${name}" объявляется как action<Input, Output>() без default.`,
            definition,
            script,
          ))
          continue
        }
        const port: ComponentSFCActionPort = {
          kind,
          role,
          name,
          inputType: typeSources[0]!,
          outputType: typeSources[1]!,
          sourceRange: toRange(property, script),
        }
        manifest.provides.actions.push(port)
        continue
      }

      const config = definition.arguments?.[0]
      if (definition.arguments?.length !== 1 || config?.type !== 'ObjectExpression') {
        diagnostics.push(makeDiagnostic(
          'sfc-port-config-required',
          `Required port "${name}" должен содержать один config object.`,
          definition,
          script,
        ))
        continue
      }
      const defaultIdentity = readStringProperty(config, 'default')
      if (!defaultIdentity) {
        diagnostics.push(makeDiagnostic(
          'sfc-port-default-required',
          `Required port "${name}" должен содержать непустой string default.`,
          config,
          script,
        ))
        continue
      }

      if (kind === 'computation') {
        if (typeSources.length !== 2) {
          diagnostics.push(makeDiagnostic('sfc-computation-port-types', `Computation port "${name}" требует <Input, Output>.`, definition, script))
          continue
        }
        const port: ComponentSFCComputationPort = {
          kind,
          name,
          defaultIdentity,
          inputType: typeSources[0]!,
          outputType: typeSources[1]!,
          sourceRange: toRange(property, script),
        }
        manifest.require.computations.push(port)
        dependencies.computations.push({ source: 'computation', id: defaultIdentity, role: 'port-default-computation' })
        validateProvider(port, options, diagnostics, property, script)
        continue
      }

      if (kind === 'component') {
        const tag = readStringProperty(config, 'tag')
        if (typeSources.length !== 1) {
          diagnostics.push(makeDiagnostic('sfc-component-port-types', `Component port "${name}" требует <Props>.`, definition, script))
          continue
        }
        if (!tag || !isValidTag(tag) || isComponentSFCBuiltInTag(tag) || tags.has(tag)) {
          diagnostics.push(makeDiagnostic(
            isComponentSFCBuiltInTag(tag ?? '') ? 'sfc-component-port-tag-reserved' : 'sfc-component-port-tag-invalid',
            `Component port "${name}" содержит invalid, duplicate или reserved tag "${tag ?? ''}".`,
            config,
            script,
          ))
          continue
        }
        tags.add(tag)
        const inputs = parseComponentSFCTypeFields(typeSources[0]!, script.content, options)
        const port: ComponentSFCComponentPort = {
          kind,
          name,
          tag,
          defaultIdentity,
          propsType: typeSources[0]!,
          inputs,
          sourceRange: toRange(property, script),
        }
        manifest.require.components.push(port)
        dependencies.components.push({ source: 'component-sfc', id: defaultIdentity, role: 'port-default-component' })
        validateProvider(port, options, diagnostics, property, script)
        continue
      }

      if (typeSources.length !== 2) {
        diagnostics.push(makeDiagnostic('sfc-action-port-types', `Action port "${name}" требует <Input, Output>.`, definition, script))
        continue
      }
      const port: ComponentSFCActionPort = {
        kind: 'action',
        role: 'require',
        name,
        defaultIdentity,
        inputType: typeSources[0]!,
        outputType: typeSources[1]!,
        sourceRange: toRange(property, script),
      }
      manifest.require.actions.push(port)
      dependencies.actions.push(defaultIdentity)
      validateProvider(port, options, diagnostics, property, script)
    }
  }
}

function parseEventConfig(
  eventName: string,
  config: any,
  script: RComponentSFC_AST_Script,
  dependencies: RComponentDependencies,
  diagnostics: RComponentDiagnostic[],
): { valid: boolean, from?: ComponentSFCEventPort['from'], action?: ComponentSFCEventAction } {
  let valid = true
  let from: ComponentSFCEventPort['from']
  let action: ComponentSFCEventAction | undefined
  const seen = new Set<string>()
  for (const property of config.properties ?? []) {
    if (property.type !== 'ObjectProperty' || property.computed) {
      diagnostics.push(makeDiagnostic('sfc-event-config-property', 'Event config не поддерживает spread, computed keys и methods.', property, script))
      valid = false
      continue
    }
    const key = readKey(property.key)
    if (!key || seen.has(key) || (key !== 'from' && key !== 'action')) {
      diagnostics.push(makeDiagnostic('sfc-event-config-property', `Event config содержит недопустимое или повторное поле "${key ?? ''}".`, property, script))
      valid = false
      continue
    }
    seen.add(key)
    if (key === 'from') {
      const value = property.value
      const ref = value?.type === 'ObjectExpression' ? readStringProperty(value, 'ref') : null
      const childEvent = value?.type === 'ObjectExpression' ? readStringProperty(value, 'event') : null
      if (!ref || !childEvent) {
        diagnostics.push(makeDiagnostic('sfc-event-from-shape', 'event.from требует literal `{ ref, event }`.', value, script))
        valid = false
      }
      else {
        from = { ref, event: childEvent }
      }
      continue
    }
    const parsedAction = parseEventAction(eventName, property.value, script, dependencies, diagnostics)
    if (!parsedAction) valid = false
    else action = parsedAction
  }
  return { valid, from, action }
}

function parseEventAction(
  eventName: string,
  node: any,
  script: RComponentSFC_AST_Script,
  dependencies: RComponentDependencies,
  diagnostics: RComponentDiagnostic[],
): ComponentSFCEventAction | null {
  if (node?.type === 'ObjectExpression') {
    const identity = readStringProperty(node, 'identity')
    const unsupported = (node.properties ?? []).some((property: any) =>
      property.type !== 'ObjectProperty'
      || property.computed
      || !['identity', 'input'].includes(readKey(property.key) ?? ''),
    )
    if (!identity || unsupported) {
      diagnostics.push(makeDiagnostic('sfc-event-action-shape', 'event.action требует `{ identity, input? }`.', node, script))
      return null
    }
    const inputNode = readObjectPropertyValue(node, 'input')
    const input = inputNode ? parseEventInput(inputNode, script, diagnostics) : undefined
    if (inputNode && !input) return null
    if (!dependencies.actions.includes(identity)) dependencies.actions.push(identity)
    return { kind: 'action', identity, ...(input ? { input } : {}) }
  }

  if (!isCall(node, 'typescript') || node.arguments?.length !== 1 || node.arguments[0]?.type !== 'ObjectExpression') {
    diagnostics.push(makeDiagnostic('sfc-event-action-shape', 'event.action поддерживает Action object или typescript({...}).', node, script))
    return null
  }
  const definition = node.arguments[0]
  const inputsNode = readObjectPropertyValue(definition, 'inputs')
  const computeProperty = (definition.properties ?? []).find((property: any) => readKey(property.key) === 'compute')
  if (inputsNode?.type !== 'ObjectExpression' || !computeProperty) {
    diagnostics.push(makeDiagnostic('sfc-event-typescript-shape', 'typescript reaction требует inputs object и compute function.', definition, script))
    return null
  }
  const inputs: Record<string, { kind: 'event', path: string | null }> = {}
  for (const property of inputsNode.properties ?? []) {
    const key = property.type === 'ObjectProperty' && !property.computed ? readKey(property.key) : null
    const value = property.type === 'ObjectProperty' ? parseEventRead(property.value) : null
    if (!key || !value) {
      diagnostics.push(makeDiagnostic('sfc-event-typescript-input', 'typescript.inputs допускает только `name: event()` или `name: event("path")`.', property, script))
      return null
    }
    inputs[key] = value
  }
  const compute = readComputeFunction(computeProperty)
  if (!compute || compute.async || compute.generator) {
    diagnostics.push(makeDiagnostic('sfc-event-typescript-compute', 'typescript.compute должен быть синхронной function/method.', computeProperty, script))
    return null
  }
  const forbidden = new Set([
    'eval', 'Function', 'Promise', 'fetch', 'XMLHttpRequest', 'WebSocket', 'Worker', 'SharedWorker',
    'setTimeout', 'setInterval', 'require', 'process', 'Deno', 'Bun', 'globalThis', 'self', 'window',
    'document', 'navigator', 'Endge',
  ])
  let invalid = false
  const emittedEvents = new Set<string>()
  walkBabelNodes(compute.body ?? compute, (current) => {
    if (current.type === 'AwaitExpression' || current.type === 'Import' || current.type === 'ImportDeclaration') invalid = true
    if (current.type === 'Identifier' && forbidden.has(current.name)) invalid = true
    const emitted = readPortsEmitCall(current)
    if (emitted) {
      emittedEvents.add(emitted)
      if (emitted === eventName) {
        diagnostics.push(makeDiagnostic('sfc-event-reaction-self-cycle', `Event "${eventName}" не может напрямую emit-ить сам себя.`, current, script))
        invalid = true
      }
    }
    const actionIdentity = readApiActionCall(current)
    if (actionIdentity && !dependencies.actions.includes(actionIdentity)) dependencies.actions.push(actionIdentity)
  })
  if (invalid) {
    diagnostics.push(makeDiagnostic('sfc-event-typescript-unsafe', 'typescript.compute содержит запрещённый global, import, await или self-emit.', computeProperty, script))
    return null
  }
  const rawSource = computeFunctionSource(compute, script.content)
  const source = rawSource.replace(/\bports\.emits\.([A-Za-z_$][\w$]*)\s*\(/g, (_match, name: string) => `api.emit(${JSON.stringify(name)}, `)
  return {
    kind: 'typescript',
    inputs,
    definitionSource: script.content.slice(node.start, node.end),
    source,
    emittedEvents: [...emittedEvents],
  }
}

function parseEventInput(node: any, script: RComponentSFC_AST_Script, diagnostics: RComponentDiagnostic[]): ComponentSFCEventInputValue | null {
  const eventRead = parseEventRead(node)
  if (eventRead) return eventRead
  if (node?.type === 'StringLiteral' || node?.type === 'NumericLiteral' || node?.type === 'BooleanLiteral')
    return { kind: 'literal', value: node.value }
  if (node?.type === 'NullLiteral') return { kind: 'literal', value: null }
  if (node?.type === 'UnaryExpression' && node.operator === '-' && node.argument?.type === 'NumericLiteral')
    return { kind: 'literal', value: -node.argument.value }
  if (node?.type === 'ArrayExpression') {
    const items: ComponentSFCEventInputValue[] = []
    for (const item of node.elements ?? []) {
      const parsed = parseEventInput(item, script, diagnostics)
      if (!parsed) return null
      items.push(parsed)
    }
    return { kind: 'array', items }
  }
  if (node?.type === 'ObjectExpression') {
    const entries: Record<string, ComponentSFCEventInputValue> = {}
    for (const property of node.properties ?? []) {
      const key = property.type === 'ObjectProperty' && !property.computed ? readKey(property.key) : null
      const parsed = property.type === 'ObjectProperty' ? parseEventInput(property.value, script, diagnostics) : null
      if (!key || !parsed) return null
      entries[key] = parsed
    }
    return { kind: 'object', entries }
  }
  diagnostics.push(makeDiagnostic('sfc-event-action-input', 'action.input поддерживает literals, arrays, objects и event(path).', node, script))
  return null
}

function parseEventRead(node: any): { kind: 'event', path: string | null } | null {
  if (!isCall(node, 'event')) return null
  if ((node.arguments?.length ?? 0) === 0) return { kind: 'event', path: null }
  const path = node.arguments?.length === 1 ? readLiteralString(node.arguments[0]) : null
  return path ? { kind: 'event', path } : null
}

function readComputeFunction(property: any): any | null {
  if (property?.type === 'ObjectMethod') return property
  if (property?.type === 'ObjectProperty' && ['FunctionExpression', 'ArrowFunctionExpression'].includes(property.value?.type)) return property.value
  return null
}

function computeFunctionSource(node: any, source: string): string {
  if (node.type !== 'ObjectMethod') return source.slice(node.start, node.end)
  const params = (node.params ?? []).map((param: any) => source.slice(param.start, param.end)).join(', ')
  return `function (${params}) ${source.slice(node.body.start, node.body.end)}`
}

function readPortsEmitCall(node: any): string | null {
  const callee = node?.type === 'CallExpression' ? node.callee : null
  const emits = callee?.type === 'MemberExpression' ? callee.object : null
  return emits?.type === 'MemberExpression'
    && emits.object?.type === 'Identifier' && emits.object.name === 'ports'
    && readKey(emits.property) === 'emits'
    ? readKey(callee.property)
    : null
}

function readApiActionCall(node: any): string | null {
  const callee = node?.type === 'CallExpression' ? node.callee : null
  if (callee?.type !== 'MemberExpression' || callee.object?.type !== 'Identifier' || callee.object.name !== 'api' || readKey(callee.property) !== 'action') return null
  return readLiteralString(node.arguments?.[0])
}

function parseForwardDefinition(
  definition: any,
  node: any,
  script: RComponentSFC_AST_Script,
  manifest: ComponentSFCPortManifest,
  diagnostics: RComponentDiagnostic[],
): void {
  if (definition?.type === 'StringLiteral' && definition.value === '*') {
    manifest.forward.rules.push(createForwardAllRule(toRange(node, script)))
    return
  }

  const definitions = definition?.type === 'ArrayExpression'
    ? definition.elements ?? []
    : [definition]

  if (definition?.type !== 'ObjectExpression' && definition?.type !== 'ArrayExpression') {
    diagnostics.push(makeDiagnostic(
      'sfc-port-forward-shape',
      'definePorts.forward должен быть "*", object rule или массивом object rules.',
      definition ?? node,
      script,
    ))
    return
  }

  for (const item of definitions) {
    const rule = parseForwardRule(item, script, diagnostics)
    if (rule)
      manifest.forward.rules.push(rule)
  }
}

function parseForwardRule(
  definition: any,
  script: RComponentSFC_AST_Script,
  diagnostics: RComponentDiagnostic[],
): ComponentSFCPortForwardRule | null {
  if (definition?.type !== 'ObjectExpression') {
    diagnostics.push(makeDiagnostic(
      'sfc-port-forward-rule-object',
      'Каждое правило definePorts.forward должно быть object literal.',
      definition,
      script,
    ))
    return null
  }

  const fromNode = readObjectPropertyValue(definition, 'from')
  const from = readForwardSources(fromNode)
  if (!from) {
    diagnostics.push(makeDiagnostic(
      'sfc-port-forward-from',
      'Forward rule требует from: "*", literal ref или массив literal refs.',
      fromNode ?? definition,
      script,
    ))
    return null
  }

  const portsNode = readObjectPropertyValue(definition, 'ports')
  const ports = portsNode == null
    ? createForwardAllPorts()
    : parseForwardPorts(portsNode, script, diagnostics)
  if (!ports)
    return null

  const namespaceNode = readObjectPropertyValue(definition, 'namespace')
  const namespace = namespaceNode == null ? 'none' : readLiteralString(namespaceNode)
  if (namespace == null) {
    diagnostics.push(makeDiagnostic(
      'sfc-port-forward-namespace',
      'Forward namespace должен быть literal string.',
      namespaceNode,
      script,
    ))
    return null
  }

  return {
    from,
    ports,
    namespace,
    sourceRange: toRange(definition, script),
  }
}

function parseForwardPorts(
  definition: any,
  script: RComponentSFC_AST_Script,
  diagnostics: RComponentDiagnostic[],
): ComponentSFCPortForwardRule['ports'] | null {
  if (definition?.type === 'StringLiteral' && definition.value === '*')
    return createForwardAllPorts()

  if (definition?.type !== 'ObjectExpression') {
    diagnostics.push(makeDiagnostic(
      'sfc-port-forward-ports',
      'Forward ports должен быть "*" или object с секциями require, provides и emits.',
      definition,
      script,
    ))
    return null
  }

  const result: ComponentSFCPortForwardRule['ports'] = {}
  const roles = new Set<ComponentSFCPortRole>()
  for (const property of definition.properties ?? []) {
    if (property.type !== 'ObjectProperty' || property.computed) {
      diagnostics.push(makeDiagnostic('sfc-port-forward-ports-property', 'Forward ports допускает только обычные properties.', property, script))
      continue
    }
    const rawRole = readKey(property.key)
    if (rawRole === 'request') {
      diagnostics.push(makeDiagnostic('sfc-port-request-renamed', 'Forward ports.request переименован в ports.require.', property, script))
      continue
    }
    if (!rawRole || !['require', 'provides', 'emits'].includes(rawRole) || roles.has(rawRole as ComponentSFCPortRole)) {
      diagnostics.push(makeDiagnostic(
        'sfc-port-forward-role',
        `Forward ports поддерживает уникальные require, provides и emits; получено "${rawRole ?? ''}".`,
        property,
        script,
      ))
      continue
    }
    const role = rawRole as ComponentSFCPortRole
    roles.add(role)
    const selector = parseForwardSelector(property.value, script, diagnostics)
    if (selector)
      result[role] = selector
  }
  return result
}

function parseForwardSelector(
  definition: any,
  script: RComponentSFC_AST_Script,
  diagnostics: RComponentDiagnostic[],
): ComponentSFCPortForwardSelector | null {
  if (definition?.type === 'StringLiteral' && definition.value === '*')
    return createForwardAllSelector()

  const literalNames = readLiteralStringArray(definition)
  if (literalNames) {
    return {
      include: literalNames,
      exclude: [],
      rename: {},
    }
  }

  if (definition?.type !== 'ObjectExpression') {
    diagnostics.push(makeDiagnostic(
      'sfc-port-forward-selector',
      'Forward selector должен быть "*", массивом port identities или object selector.',
      definition,
      script,
    ))
    return null
  }

  const includeNode = readObjectPropertyValue(definition, 'include')
  const include = includeNode == null
    ? '*'
    : includeNode.type === 'StringLiteral' && includeNode.value === '*'
      ? '*'
      : readLiteralStringArray(includeNode)
  const excludeNode = readObjectPropertyValue(definition, 'exclude')
  const exclude = excludeNode == null ? [] : readLiteralStringArray(excludeNode)
  const renameNode = readObjectPropertyValue(definition, 'rename')
  const rename = renameNode == null ? {} : readLiteralStringMap(renameNode)
  const namespaceNode = readObjectPropertyValue(definition, 'namespace')
  const namespace = namespaceNode == null ? undefined : readLiteralString(namespaceNode) ?? undefined

  if (include == null || exclude == null || rename == null || (namespaceNode != null && namespace == null)) {
    diagnostics.push(makeDiagnostic(
      'sfc-port-forward-selector-shape',
      'Forward selector использует literal include, exclude, rename и namespace.',
      definition,
      script,
    ))
    return null
  }

  return { include, exclude, rename, namespace }
}

function createForwardAllRule(sourceRange?: ReturnType<typeof toRange>): ComponentSFCPortForwardRule {
  return {
    from: '*',
    ports: createForwardAllPorts(),
    namespace: 'none',
    sourceRange,
  }
}

function createForwardAllPorts(): ComponentSFCPortForwardRule['ports'] {
  return {
    require: createForwardAllSelector(),
    provides: createForwardAllSelector(),
    emits: createForwardAllSelector(),
  }
}

function createForwardAllSelector(): ComponentSFCPortForwardSelector {
  return { include: '*', exclude: [], rename: {} }
}

function readForwardSources(node: any): '*' | string[] | null {
  if (node?.type === 'StringLiteral')
    return node.value === '*' ? '*' : node.value.trim() ? [node.value.trim()] : null
  const values = readLiteralStringArray(node)
  if (!values?.length || values.includes('*'))
    return null
  return values
}

function readLiteralStringArray(node: any): string[] | null {
  if (node?.type !== 'ArrayExpression') return null
  const result: string[] = []
  for (const item of node.elements ?? []) {
    const value = readLiteralString(item)
    if (!value) return null
    result.push(value)
  }
  return result
}

function readLiteralStringMap(node: any): Record<string, string> | null {
  if (node?.type !== 'ObjectExpression') return null
  const result: Record<string, string> = {}
  for (const property of node.properties ?? []) {
    if (property.type !== 'ObjectProperty' || property.computed) return null
    const key = readKey(property.key)
    const value = readLiteralString(property.value)
    if (!key || !value) return null
    result[key] = value
  }
  return result
}

function readObjectPropertyValue(object: any, name: string): any | null {
  for (const property of object?.properties ?? []) {
    if (property.type === 'ObjectProperty' && !property.computed && readKey(property.key) === name)
      return property.value
  }
  return null
}

function readLiteralString(node: any): string | null {
  return node?.type === 'StringLiteral' ? node.value.trim() || null : null
}

function parsePortCalls(
  statements: any[],
  bindingName: string,
  script: RComponentSFC_AST_Script,
  manifest: ComponentSFCPortManifest,
  calls: RComponentSFC_IR_PortCall[],
  diagnostics: RComponentDiagnostic[],
  options: ComponentSFCPortAnalysisOptions,
): void {
  const portsByName = new Map<string, ComponentSFCComputationPort | ComponentSFCComponentPort>()
  for (const port of manifest.require.computations) portsByName.set(port.name, port)
  for (const port of manifest.require.components) portsByName.set(port.name, port)
  const props = parseComponentSFCProps(script, options)
  const locals = script.bindings.map(binding => binding.name)
  const topLevelCalls = new Set<number>()

  for (const statement of statements) {
    if (statement.type !== 'VariableDeclaration') continue
    for (const declaration of statement.declarations ?? []) {
      const init = declaration.init
      if (!isPortCall(init, bindingName)) continue
      if (typeof init.start === 'number') topLevelCalls.add(init.start)
      const local = declaration.id?.type === 'Identifier' ? declaration.id.name : ''
      const portName = readRequiredPortCallName(init, bindingName)
      const port = portName ? portsByName.get(portName) : null
      if (statement.kind !== 'const' || !local) {
        diagnostics.push(makeDiagnostic(
          'sfc-port-call-top-level-const',
          'Computation port call должен инициализировать top-level const.',
          declaration,
          script,
        ))
        continue
      }
      if (!port) {
        diagnostics.push(makeDiagnostic(
          'sfc-port-call-unknown',
          `Port "${portName ?? ''}" не объявлен.`,
          init,
          script,
        ))
        continue
      }
      if (port.kind !== 'computation') {
        diagnostics.push(makeDiagnostic(
          'sfc-component-port-call-invalid',
          `Component port "${port.name}" используется только как local template tag.`,
          init,
          script,
        ))
        continue
      }
      const argument = init.arguments?.[0]
      if (init.arguments?.length !== 1 || argument?.type !== 'ObjectExpression') {
        diagnostics.push(makeDiagnostic(
          'sfc-computation-port-call-input',
          `Computation port "${port.name}" принимает ровно один input object.`,
          init,
          script,
        ))
        continue
      }
      const source = script.content.slice(argument.start, argument.end)
      const compiled = compileComponentSFCExpression(source, {
        props,
        locals,
        sourcePath: `script.${local}`,
      })
      diagnostics.push(...compiled.diagnostics.map(item => ({
        ...item,
        start: item.start == null ? undefined : script.range.start + argument.start + item.start,
        end: item.end == null ? undefined : script.range.start + argument.start + item.end,
      })))
      calls.push({
        kind: 'computation',
        local,
        port: port.name,
        defaultIdentity: port.defaultIdentity,
        input: compiled.value,
        sourceRange: toRange(declaration, script),
      })
    }
  }

  walkBabelNodes(statements, (node) => {
    if (!isPortCall(node, bindingName) || topLevelCalls.has(node.start)) return
    diagnostics.push(makeDiagnostic(
      'sfc-port-call-top-level-const',
      'Computation port call должен инициализировать top-level const.',
      node,
      script,
    ))
  })
}

function validateProvider(
  port: ComponentSFCComputationPort | ComponentSFCComponentPort | ComponentSFCActionPort,
  options: ComponentSFCPortAnalysisOptions,
  diagnostics: RComponentDiagnostic[],
  node: any,
  script: RComponentSFC_AST_Script,
): void {
  if (!options.resolveProvider) return
  const defaultIdentity = port.defaultIdentity
  if (!defaultIdentity) return
  const provider = options.resolveProvider(defaultIdentity, port.kind)
  if (!provider) {
    diagnostics.push(makeDiagnostic(
      'sfc-port-default-missing',
      `Default provider "${defaultIdentity}" для port "${port.name}" не найден.`,
      node,
      script,
    ))
    return
  }
  if (provider.kind !== port.kind) {
    diagnostics.push(makeDiagnostic(
      'sfc-port-default-kind',
      `Default provider "${defaultIdentity}" имеет kind "${provider.kind}", ожидался "${port.kind}".`,
      node,
      script,
    ))
    return
  }
  if (!provider.active) {
    diagnostics.push(makeDiagnostic(
      'sfc-port-default-inactive',
      `Default provider "${defaultIdentity}" неактивен.`,
      node,
      script,
    ))
  }

  if (port.kind === 'component' && provider.kind === 'component') {
    const expected = new Map(port.inputs.map(input => [input.name, input]))
    const actual = new Map(provider.inputs.map(input => [input.name, input]))
    const mismatch = port.inputs.some((input) => {
      const candidate = actual.get(input.name)
      return !candidate || normalizeType(candidate.type) !== normalizeType(input.type)
        || Boolean(candidate.isArray) !== Boolean(input.isArray)
    }) || provider.inputs.some(input => !input.optional && !expected.has(input.name))
    if (mismatch) {
      diagnostics.push(makeDiagnostic(
        'sfc-component-port-contract',
        `Component "${provider.identity}" не соответствует props contract port "${port.name}".`,
        node,
        script,
        'warning',
      ))
    }
  }
}

function normalizeType(value: string): string {
  return String(value ?? '').replace(/\s+/g, '')
}

function parseComponentSFCProps(
  script: RComponentSFC_AST_Script,
  options: ComponentSFCPortAnalysisOptions,
): string[] {
  return script.props
    ? parseComponentSFCTypeFields(script.props.source, script.content, options).map(prop => prop.name)
    : []
}

function readTypeParameters(call: any, content: string): string[] {
  const params = call.typeParameters?.params ?? call.typeArguments?.params ?? []
  return params
    .filter((item: any) => item?.start != null && item?.end != null)
    .map((item: any) => content.slice(item.start, item.end).trim())
}

function readStringProperty(object: any, name: string): string | null {
  for (const property of object.properties ?? []) {
    if (property.type !== 'ObjectProperty' || property.computed || readKey(property.key) !== name)
      continue
    return property.value?.type === 'StringLiteral' ? property.value.value.trim() || null : null
  }
  return null
}

function readKey(node: any): string | null {
  if (node?.type === 'Identifier') return node.name
  if (node?.type === 'StringLiteral') return node.value
  return null
}

function isCall(node: any, name: string): boolean {
  return node?.type === 'CallExpression'
    && node.callee?.type === 'Identifier'
    && node.callee.name === name
}

function isPortCall(node: any, bindingName: string): boolean {
  return readRequiredPortCallName(node, bindingName) != null
}

function readRequiredPortCallName(node: any, bindingName: string): string | null {
  const callee = node?.type === 'CallExpression' ? node.callee : null
  const roleMember = callee?.type === 'MemberExpression' ? callee.object : null
  if (roleMember?.type !== 'MemberExpression') return null
  if (roleMember.object?.type !== 'Identifier' || roleMember.object.name !== bindingName) return null
  if (readKey(roleMember.property) !== 'require') return null
  return readKey(callee.property)
}

function walkBabelNodes(value: unknown, visit: (node: any) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkBabelNodes(item, visit)
    return
  }
  if (!value || typeof value !== 'object') return
  const node = value as Record<string, unknown>
  if (typeof node.type === 'string') visit(node)
  for (const [key, child] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra') continue
    if (Array.isArray(child) || (child && typeof child === 'object'))
      walkBabelNodes(child, visit)
  }
}

function isValidTag(tag: string): boolean {
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(tag)
}

function toRange(node: any, script: RComponentSFC_AST_Script) {
  return {
    start: script.range.start + Number(node?.start ?? 0),
    end: script.range.start + Number(node?.end ?? node?.start ?? 0),
  }
}

function makeDiagnostic(
  code: string,
  message: string,
  node: any,
  script: RComponentSFC_AST_Script,
  severity: RComponentDiagnostic['severity'] = 'error',
): RComponentDiagnostic {
  const range = toRange(node, script)
  return {
    severity,
    code,
    message,
    sourcePath: 'script.definePorts',
    start: range.start,
    end: range.end,
  }
}
