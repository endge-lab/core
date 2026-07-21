import type { RComponentDependencies, RComponentDiagnostic } from '@/domain/types/component/component-core.types'
import type {
  ComponentSFCActionPort,
  ComponentSFCComponentPort,
  ComponentSFCComputationPort,
  ComponentSFCEventPort,
  ComponentSFCPortForwardOrigin,
  ComponentSFCPortForwardRule,
  ComponentSFCPortForwardSelector,
  ComponentSFCPortManifest,
  ComponentSFCPortRole,
  RComponentSFC_IR_ElementNode,
  RComponentSFC_IR_Node,
  RComponentSFC_IR_Template,
} from '@/domain/types/component/sfc'
import { createEmptyComponentSFCPortManifest } from '@/domain/types/component/sfc'
import { TABLE_EVENT_DEFINITIONS } from '@/domain/types/component/sfc/table-events.types'
import { TABLE_RUNTIME_ACTION_IDS } from '@/domain/types/runtime/action.types'

type ForwardablePort = ComponentSFCComputationPort | ComponentSFCComponentPort | ComponentSFCActionPort | ComponentSFCEventPort

interface LocalComponentBinding {
  nodeId: string
  ref?: string
  componentIdentity?: string
  componentTag: string
  manifest: ComponentSFCPortManifest | null
}

export interface ComponentSFCPortForwardOptions {
  resolveComponentPortManifest?: (identity: string) => ComponentSFCPortManifest | null
}

export interface ComponentSFCPortForwardResult {
  diagnostics: RComponentDiagnostic[]
  dependencies: RComponentDependencies
}

/** Resolves static forward rules against component bindings owned by this SFC template. */
export function resolveComponentSFCPortForwards(
  manifest: ComponentSFCPortManifest,
  template: RComponentSFC_IR_Template | null,
  options: ComponentSFCPortForwardOptions = {},
): ComponentSFCPortForwardResult {
  const diagnostics: RComponentDiagnostic[] = []
  const dependencies = createEmptyDependencies()
  if (!template)
    return { diagnostics, dependencies }

  const bindings = collectLocalComponentBindings(template, options)
  const refs = new Map<string, LocalComponentBinding>()
  for (const binding of bindings) {
    if (!binding.ref) continue
    const duplicate = refs.get(binding.ref)
    if (duplicate) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-port-forward-ref-duplicate',
        message: `Forward ref "${binding.ref}" неоднозначен: он используется узлами "${duplicate.nodeId}" и "${binding.nodeId}".`,
        sourcePath: 'template',
      })
      continue
    }
    refs.set(binding.ref, binding)
  }

  validateExplicitEventSources(manifest, refs, diagnostics)
  if (manifest.forward.rules.length === 0)
    return { diagnostics, dependencies }

  const names = collectManifestNames(manifest)
  const componentTags = new Set(manifest.require.components.map(port => port.tag))
  for (const rule of manifest.forward.rules) {
    const sources = rule.from === '*'
      ? bindings
      : rule.from.flatMap((ref) => {
          const binding = refs.get(ref)
          if (binding) return [binding]
          diagnostics.push(forwardDiagnostic(
            'error',
            'sfc-port-forward-ref-missing',
            `Forward source ref "${ref}" не найден в local component scope.`,
            rule,
          ))
          return []
        })

    for (const source of sources) {
      if (!source.manifest) {
        diagnostics.push(forwardDiagnostic(
          'error',
          'sfc-port-forward-manifest-unresolved',
          `Public port manifest компонента "${source.componentIdentity ?? source.componentTag}" не удалось разрешить.`,
          rule,
        ))
        continue
      }
      resolveRuleSource(manifest, rule, source, names, componentTags, dependencies, diagnostics)
    }
  }

  return { diagnostics, dependencies }
}

/** Returns the intrinsic public manifest of a renderer-neutral built-in component. */
export function createBuiltInComponentPortManifest(tag: string): ComponentSFCPortManifest | null {
  if (tag !== 'Table') return null
  const manifest = createEmptyComponentSFCPortManifest()
  manifest.provides.actions = Object.values(TABLE_RUNTIME_ACTION_IDS).map(name => ({
    kind: 'action',
    role: 'provides',
    name,
    inputType: 'unknown',
    outputType: 'void',
  }))
  manifest.emits.events = TABLE_EVENT_DEFINITIONS.map(event => ({
    kind: 'event',
    role: 'emits',
    name: event.name,
    payloadType: event.payloadType,
  }))
  return manifest
}

/** Built-in manifests used by compiler and frontend-only event catalogs. */
export function listBuiltInComponentPortManifests(): Array<{ tag: string, manifest: ComponentSFCPortManifest }> {
  const table = createBuiltInComponentPortManifest('Table')
  return table ? [{ tag: 'Table', manifest: table }] : []
}

function validateExplicitEventSources(
  manifest: ComponentSFCPortManifest,
  refs: Map<string, LocalComponentBinding>,
  diagnostics: RComponentDiagnostic[],
): void {
  for (const event of manifest.emits.events) {
    if (!event.from) continue
    const source = refs.get(event.from.ref)
    if (!source) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-event-from-ref-missing',
        message: `Event source ref "${event.from.ref}" не найден в local component scope.`,
        sourcePath: 'script.definePorts.emits',
        start: event.sourceRange?.start,
        end: event.sourceRange?.end,
      })
      continue
    }
    const sourceEvent = source.manifest?.emits.events.find(candidate => candidate.name === event.from!.event)
    if (!sourceEvent) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-event-from-event-missing',
        message: `Component "${describeSource(source)}" не публикует Event "${event.from.event}".`,
        sourcePath: 'script.definePorts.emits',
        start: event.sourceRange?.start,
        end: event.sourceRange?.end,
      })
      continue
    }
    if (normalizeType(sourceEvent.payloadType) !== normalizeType(event.payloadType)) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-event-from-payload-mismatch',
        message: `Payload Event "${event.name}" (${event.payloadType}) не совпадает с ${describeSource(source)}.${sourceEvent.name} (${sourceEvent.payloadType}).`,
        sourcePath: 'script.definePorts.emits',
        start: event.sourceRange?.start,
        end: event.sourceRange?.end,
      })
      continue
    }
    event.forwardedFrom = {
      nodeId: source.nodeId,
      ref: source.ref,
      componentIdentity: source.componentIdentity,
      componentTag: source.componentTag,
      portName: sourceEvent.name,
    }
  }
}

function collectLocalComponentBindings(
  template: RComponentSFC_IR_Template,
  options: ComponentSFCPortForwardOptions,
): LocalComponentBinding[] {
  const result: LocalComponentBinding[] = []
  const visit = (node: RComponentSFC_IR_Node): void => {
    if (node.kind !== 'element') return
    const ref = literalString(node.props.ref)
    if (node.tag === 'Table') {
      result.push({
        nodeId: node.id,
        ref,
        componentTag: 'Table',
        manifest: createBuiltInComponentPortManifest('Table'),
      })
    }
    else if (node.tag === 'Component') {
      const componentIdentity = literalString(node.props.is)
      result.push({
        nodeId: node.id,
        ref,
        componentIdentity,
        componentTag: node.componentTag ?? 'Component',
        manifest: componentIdentity
          ? options.resolveComponentPortManifest?.(componentIdentity) ?? null
          : null,
      })
    }
    for (const child of node.children)
      visit(child)
  }
  for (const root of template.roots)
    visit(root)
  return result
}

function resolveRuleSource(
  target: ComponentSFCPortManifest,
  rule: ComponentSFCPortForwardRule,
  source: LocalComponentBinding,
  names: Map<string, ForwardablePort>,
  componentTags: Set<string>,
  dependencies: RComponentDependencies,
  diagnostics: RComponentDiagnostic[],
): void {
  for (const role of ['require', 'provides', 'emits'] as const) {
    const selector = rule.ports[role]
    if (!selector) continue
    const sourcePorts = portsForRole(source.manifest!, role)
    const selected = sourcePorts.filter(port => matchesSelector(port.name, selector))
    reportUnmatchedIncludes(selector, selected, source, role, rule, diagnostics)

    for (const port of selected) {
      const publicName = resolvePublicName(port.name, source, rule, selector, diagnostics)
      if (!publicName) continue
      const existing = names.get(publicName)
      if (existing) {
        const existingSource = existing.kind === 'event' ? existing.from : undefined
        if (
          role === 'emits'
          && existing.kind === 'event'
          && existingSource?.ref === source.ref
          && existingSource?.event === port.name
        ) {
          existing.forwardedFrom ??= {
            nodeId: source.nodeId,
            ref: source.ref,
            componentIdentity: source.componentIdentity,
            componentTag: source.componentTag,
            portName: port.name,
          }
          continue
        }
        diagnostics.push(forwardDiagnostic(
          'error',
          'sfc-port-forward-collision',
          `Forward port "${publicName}" из "${describeSource(source)}" конфликтует с уже объявленным port того же имени.`,
          rule,
        ))
        continue
      }

      const origin: ComponentSFCPortForwardOrigin = {
        nodeId: source.nodeId,
        ref: source.ref,
        componentIdentity: source.componentIdentity,
        componentTag: source.componentTag,
        portName: port.name,
      }
      const forwarded = { ...port, name: publicName, forwardedFrom: origin, sourceRange: rule.sourceRange } as ForwardablePort
      if (forwarded.kind === 'component' && componentTags.has(forwarded.tag)) {
        diagnostics.push(forwardDiagnostic(
          'error',
          'sfc-port-forward-tag-collision',
          `Forward component tag "${forwarded.tag}" из "${describeSource(source)}" уже объявлен.`,
          rule,
        ))
        continue
      }

      appendPort(target, role, forwarded)
      names.set(publicName, forwarded)
      if (forwarded.kind === 'component') componentTags.add(forwarded.tag)
      appendDependency(dependencies, forwarded)
    }
  }
}

function normalizeType(value: string): string {
  return String(value ?? '').replace(/\s+/g, '')
}

function portsForRole(manifest: ComponentSFCPortManifest, role: ComponentSFCPortRole): ForwardablePort[] {
  if (role === 'require')
    return [...manifest.require.computations, ...manifest.require.components, ...manifest.require.actions]
  if (role === 'provides')
    return [...manifest.provides.actions]
  return [...manifest.emits.events]
}

function appendPort(manifest: ComponentSFCPortManifest, role: ComponentSFCPortRole, port: ForwardablePort): void {
  if (role === 'provides' && port.kind === 'action') {
    manifest.provides.actions.push({ ...port, role: 'provides' })
    return
  }
  if (role === 'emits' && port.kind === 'event') {
    manifest.emits.events.push(port)
    return
  }
  if (role !== 'require') return
  if (port.kind === 'computation') manifest.require.computations.push(port)
  else if (port.kind === 'component') manifest.require.components.push(port)
  else if (port.kind === 'action') manifest.require.actions.push({ ...port, role: 'require' })
}

function appendDependency(dependencies: RComponentDependencies, port: ForwardablePort): void {
  if (!port.forwardedFrom || port.kind === 'event' || (port.kind === 'action' && port.role === 'provides'))
    return
  if (port.kind === 'computation')
    dependencies.computations.push({ source: 'computation', id: port.defaultIdentity, role: 'port-default-computation' })
  else if (port.kind === 'component')
    dependencies.components.push({ source: 'component-sfc', id: port.defaultIdentity, role: 'port-default-component' })
  else if (port.defaultIdentity)
    dependencies.actions.push(port.defaultIdentity)
}

function collectManifestNames(manifest: ComponentSFCPortManifest): Map<string, ForwardablePort> {
  const result = new Map<string, ForwardablePort>()
  for (const role of ['require', 'provides', 'emits'] as const) {
    for (const port of portsForRole(manifest, role))
      result.set(port.name, port)
  }
  return result
}

function matchesSelector(name: string, selector: ComponentSFCPortForwardSelector): boolean {
  const included = selector.include === '*' || selector.include.some(pattern => matchesPattern(name, pattern))
  return included && !selector.exclude.some(pattern => matchesPattern(name, pattern))
}

function matchesPattern(value: string, pattern: string): boolean {
  if (pattern === '*') return true
  const expression = pattern
    .split('*')
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${expression}$`).test(value)
}

function resolvePublicName(
  sourceName: string,
  source: LocalComponentBinding,
  rule: ComponentSFCPortForwardRule,
  selector: ComponentSFCPortForwardSelector,
  diagnostics: RComponentDiagnostic[],
): string | null {
  const renamed = selector.rename[sourceName] ?? sourceName
  const namespace = selector.namespace ?? rule.namespace
  if (namespace === 'none' || namespace === '') return renamed
  if (namespace === 'ref') {
    if (source.ref) return `${source.ref}.${renamed}`
    diagnostics.push(forwardDiagnostic(
      'error',
      'sfc-port-forward-ref-required',
      `Forward namespace "ref" требует literal ref у компонента "${source.componentTag}".`,
      rule,
    ))
    return null
  }
  return `${namespace}.${renamed}`
}

function reportUnmatchedIncludes(
  selector: ComponentSFCPortForwardSelector,
  selected: ForwardablePort[],
  source: LocalComponentBinding,
  role: ComponentSFCPortRole,
  rule: ComponentSFCPortForwardRule,
  diagnostics: RComponentDiagnostic[],
): void {
  if (selector.include === '*') return
  for (const pattern of selector.include) {
    if (selected.some(port => matchesPattern(port.name, pattern))) continue
    diagnostics.push(forwardDiagnostic(
      'warning',
      'sfc-port-forward-selection-empty',
      `Forward selector "${pattern}" не нашёл ports в ${role} компонента "${describeSource(source)}".`,
      rule,
    ))
  }
}

function forwardDiagnostic(
  severity: 'warning' | 'error',
  code: string,
  message: string,
  rule: ComponentSFCPortForwardRule,
): RComponentDiagnostic {
  return {
    severity,
    code,
    message,
    sourcePath: 'script.definePorts.forward',
    start: rule.sourceRange?.start,
    end: rule.sourceRange?.end,
  }
}

function describeSource(source: LocalComponentBinding): string {
  return source.ref ?? source.componentIdentity ?? source.componentTag
}

function literalString(value: RComponentSFC_IR_ElementNode['props'][string] | undefined): string | undefined {
  return value?.kind === 'literal' && typeof value.value === 'string' && value.value.trim()
    ? value.value.trim()
    : undefined
}

function createEmptyDependencies(): RComponentDependencies {
  return {
    components: [],
    computations: [],
    actions: [],
    dataSources: [],
    renderers: [],
  }
}
