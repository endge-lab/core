import { parse as parseTS } from '@babel/parser'

import type { RComponentDependencies, RComponentDiagnostic } from '@/domain/types/component/component-core.types'
import type {
  ComponentSFCComponentPort,
  ComponentSFCComputationPort,
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
    expectedKind: 'computation' | 'component',
  ) => ComponentSFCPortProviderDescriptor | null
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

  const names = new Set<string>()
  const tags = new Set<string>()
  for (const property of object.properties ?? []) {
    if (property.type !== 'ObjectProperty' || property.computed) {
      diagnostics.push(makeDiagnostic(
        'sfc-port-property-shape',
        'Port должен быть обычным object property без spread/computed key.',
        property,
        script,
      ))
      continue
    }
    const name = readKey(property.key)
    if (!name || names.has(name)) {
      diagnostics.push(makeDiagnostic(
        'sfc-port-name-invalid',
        `Port name "${name}" отсутствует или повторяется.`,
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
        : null
    if (!kind) {
      diagnostics.push(makeDiagnostic(
        'sfc-port-kind-unsupported',
        `Port "${name}" должен использовать computation(...) или component(...).`,
        definition,
        script,
      ))
      continue
    }

    const config = definition.arguments?.[0]
    if (definition.arguments?.length !== 1 || config?.type !== 'ObjectExpression') {
      diagnostics.push(makeDiagnostic(
        'sfc-port-config-required',
        `Port "${name}" должен содержать один config object.`,
        definition,
        script,
      ))
      continue
    }
    const defaultIdentity = readStringProperty(config, 'default')
    if (!defaultIdentity) {
      diagnostics.push(makeDiagnostic(
        'sfc-port-default-required',
        `Port "${name}" должен содержать непустой string default.`,
        config,
        script,
      ))
      continue
    }

    const typeSources = readTypeParameters(definition, script.content)
    if (kind === 'computation') {
      if (typeSources.length !== 2) {
        diagnostics.push(makeDiagnostic(
          'sfc-computation-port-types',
          `Computation port "${name}" требует <Input, Output>.`,
          definition,
          script,
        ))
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
      manifest.computations.push(port)
      dependencies.computations.push({
        source: 'computation',
        id: defaultIdentity,
        role: 'port-default-computation',
      })
      validateProvider(port, options, diagnostics, property, script)
      continue
    }

    const tag = readStringProperty(config, 'tag')
    if (typeSources.length !== 1) {
      diagnostics.push(makeDiagnostic(
        'sfc-component-port-types',
        `Component port "${name}" требует <Props>.`,
        definition,
        script,
      ))
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
    const inputs = parseComponentSFCTypeFields(typeSources[0]!, script.content)
    const port: ComponentSFCComponentPort = {
      kind,
      name,
      tag,
      defaultIdentity,
      propsType: typeSources[0]!,
      inputs,
      sourceRange: toRange(property, script),
    }
    manifest.components.push(port)
    dependencies.components.push({
      source: 'component-sfc',
      id: defaultIdentity,
      role: 'port-default-component',
    })
    validateProvider(port, options, diagnostics, property, script)
  }
}

function parsePortCalls(
  statements: any[],
  bindingName: string,
  script: RComponentSFC_AST_Script,
  manifest: ComponentSFCPortManifest,
  calls: RComponentSFC_IR_PortCall[],
  diagnostics: RComponentDiagnostic[],
): void {
  const portsByName = new Map<string, ComponentSFCComputationPort | ComponentSFCComponentPort>()
  for (const port of manifest.computations) portsByName.set(port.name, port)
  for (const port of manifest.components) portsByName.set(port.name, port)
  const props = parseComponentSFCProps(script)
  const locals = script.bindings.map(binding => binding.name)
  const topLevelCalls = new Set<number>()

  for (const statement of statements) {
    if (statement.type !== 'VariableDeclaration') continue
    for (const declaration of statement.declarations ?? []) {
      const init = declaration.init
      if (!isPortCall(init, bindingName)) continue
      if (typeof init.start === 'number') topLevelCalls.add(init.start)
      const local = declaration.id?.type === 'Identifier' ? declaration.id.name : ''
      const portName = readKey(init.callee.property)
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
  port: ComponentSFCComputationPort | ComponentSFCComponentPort,
  options: ComponentSFCPortAnalysisOptions,
  diagnostics: RComponentDiagnostic[],
  node: any,
  script: RComponentSFC_AST_Script,
): void {
  if (!options.resolveProvider) return
  const provider = options.resolveProvider(port.defaultIdentity, port.kind)
  if (!provider) {
    diagnostics.push(makeDiagnostic(
      'sfc-port-default-missing',
      `Default provider "${port.defaultIdentity}" для port "${port.name}" не найден.`,
      node,
      script,
    ))
    return
  }
  if (provider.kind !== port.kind) {
    diagnostics.push(makeDiagnostic(
      'sfc-port-default-kind',
      `Default provider "${port.defaultIdentity}" имеет kind "${provider.kind}", ожидался "${port.kind}".`,
      node,
      script,
    ))
    return
  }
  if (!provider.active) {
    diagnostics.push(makeDiagnostic(
      'sfc-port-default-inactive',
      `Default provider "${port.defaultIdentity}" неактивен.`,
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
      ))
    }
  }
}

function normalizeType(value: string): string {
  return String(value ?? '').replace(/\s+/g, '')
}

function parseComponentSFCProps(script: RComponentSFC_AST_Script): string[] {
  return script.props
    ? parseComponentSFCTypeFields(script.props.source, script.content).map(prop => prop.name)
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
  return node?.type === 'CallExpression'
    && node.callee?.type === 'MemberExpression'
    && node.callee.object?.type === 'Identifier'
    && node.callee.object.name === bindingName
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
): RComponentDiagnostic {
  const range = toRange(node, script)
  return {
    severity: 'error',
    code,
    message,
    sourcePath: 'script.definePorts',
    start: range.start,
    end: range.end,
  }
}
