import type { RComponentDependencies, RComponentDiagnostic } from '@/domain/types/component/component-core.types'
import type {
  RComponentSFC_AST_Attribute,
  RComponentSFC_AST_Directive,
  RComponentSFC_AST_ElementNode,
  RComponentSFC_AST_InterpolationNode,
  RComponentSFC_AST_Template,
  RComponentSFC_AST_TemplateNode,
  RComponentSFC_AST_TextNode,
} from '@/domain/types/component/sfc/ast.types'
import type {
  ComponentSFCVariant,
  RComponentSFC_IR_Directives,
  RComponentSFC_IR_ElementNode,
  RComponentSFC_IR_EventBinding,
  RComponentSFC_IR_EventModifier,
  RComponentSFC_IR_InteractionGroup,
  RComponentSFC_IR_Node,
  RComponentSFC_IR_Tag,
  RComponentSFC_IR_Template,
  RComponentSFC_IR_Value,
} from '@/domain/types/component/sfc/ir.types'
import type {
  ComponentSFCComponentPort,
  ComponentSFCPortManifest,
  ComponentSFCPortProviderDescriptor,
  ComponentSFCRequiredPortBinding,
  ComponentSFCRequiredPortKind,
} from '@/domain/types/component/sfc/ports.types'
import type { EndgeSFCEditingConfiguration } from '@/domain/types/configuration/configuration.type'
import type { ProgramNodeMetadata } from '@/domain/types/program/program-metadata.types'
import { parseExpression } from '@babel/parser'
import { DEFAULT_ENDGE_SFC_EDITING_CONFIGURATION } from '@/domain/configuration/sfc-editing.config'
import { createEmptyComponentDependencies } from '@/domain/types/component/component-core.types'
import { createEmptyComponentSFCPortManifest } from '@/domain/types/component/sfc/ports.types'
import { isComponentSFCBuiltInTag } from '@/model/services/compiler/component-sfc/component-sfc-built-in-tags'
import { compileComponentSFCExpression } from '@/model/services/compiler/component-sfc/component-sfc-expression'
import { createBuiltInComponentPortManifest } from '@/model/services/compiler/component-sfc/component-sfc-forward'
import {
  compileComponentSFCInteractionAnnotation,
  hasComponentSFCPassivePreventConflict,
} from '@/model/services/compiler/component-sfc/component-sfc-interactions'
import { compileComponentSFCLocalEventActions } from '@/model/services/compiler/component-sfc/component-sfc-ports'
import { normalizeComponentSFCTableColumnPin } from '@/model/services/compiler/component-sfc/component-sfc-table-pin'
import { normalizeComponentSFCTableSort } from '@/model/services/compiler/component-sfc/component-sfc-table-sort'
import { normalizeComponentSFCTableColumnVisibility } from '@/model/services/compiler/component-sfc/component-sfc-table-visibility'
import { compileProgramMetadataSource } from '@/model/services/source-engine/compilers/source-metadata-compile'

/** Контекст компиляции template в IR. */
export interface ComponentSFCTemplateCompileContext {
  /** Имена props для классификации expression reads. */
  props: string[]

  /** Имена locals для классификации expression reads. */
  locals: string[]

  /** Local component ports have priority over the global user tag registry. */
  componentPorts?: ComponentSFCComponentPort[]

  /** Required ports owned by the Component SFC currently being compiled. */
  ownerPorts?: ComponentSFCPortManifest | null

  /** Разрешает зарегистрированный пользовательский tag в identity компонента. */
  resolveComponentTag?: (tag: string) => string | null

  /** Проверяет статическую identity из Component is. */
  hasComponentIdentity?: (identity: string) => boolean

  /** Resolves public Events of a nested user Component for local `@event` bindings. */
  resolveComponentPortManifest?: (identity: string) => ComponentSFCPortManifest | null

  /** Resolves static providers used by flat child port bindings. */
  resolvePortProvider?: (
    identity: string,
    expectedKind: ComponentSFCRequiredPortKind,
  ) => ComponentSFCPortProviderDescriptor | null

  /** Resolves explicit root Variant names of a nested custom component. */
  resolveComponentVariants?: (identity: string) => string[] | null

  /** Effective defaults завершения edit session для текущего build context. */
  sfcEditing?: EndgeSFCEditingConfiguration
}

/** Результат компиляции template в IR. */
export interface ComponentSFCTemplateCompileResult {
  /** IR template или null, если template отсутствует. */
  template: RComponentSFC_IR_Template | null

  /** Зависимости, найденные в template. */
  dependencies: RComponentDependencies

  /** Diagnostics template pass. */
  diagnostics: RComponentDiagnostic[]

  /** Публичная metadata внутренних template-узлов. */
  metadata: ProgramNodeMetadata[]

  /** Events emitted by declarative template reactions or editable behavior. */
  emittedEvents: string[]
}

export { isComponentSFCBuiltInTag } from '@/model/services/compiler/component-sfc/component-sfc-built-in-tags'

/** Компилирует AST template в renderer-neutral Endge SFC IR. */
export function compileComponentSFCTemplate(
  template: RComponentSFC_AST_Template | null,
  context: ComponentSFCTemplateCompileContext,
): ComponentSFCTemplateCompileResult {
  const diagnostics: RComponentDiagnostic[] = []
  const dependencies = createEmptyComponentDependencies()
  const metadata: ProgramNodeMetadata[] = []

  if (!template) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-template-missing',
      message: 'SFC-компонент должен содержать template.',
      sourcePath: 'template',
    })

    return {
      template: null,
      dependencies,
      metadata,
      diagnostics,
      emittedEvents: [],
    }
  }

  const roots = template.roots
    .map((node, index) => compileTemplateNode(node, `root-${index}`, context, dependencies, metadata, diagnostics))
    .filter((node): node is RComponentSFC_IR_Node => node != null)
  validateTooltipTree(roots, diagnostics)
  const variants = validateVariantContainer(roots, diagnostics, 'template', false)
  const emittedEvents = collectTemplateEmittedEvents(roots)

  return {
    template: {
      roots,
      ...(variants.length ? { variants } : {}),
    },
    dependencies,
    metadata,
    diagnostics,
    emittedEvents,
  }
}

function compileTemplateNode(
  node: RComponentSFC_AST_TemplateNode,
  id: string,
  context: ComponentSFCTemplateCompileContext,
  dependencies: RComponentDependencies,
  metadata: ProgramNodeMetadata[],
  diagnostics: RComponentDiagnostic[],
): RComponentSFC_IR_Node | null {
  if (node.kind === 'text') {
    return compileTextNode(node, id)
  }

  if (node.kind === 'interpolation') {
    return compileInterpolationNode(node, id, context, diagnostics)
  }

  return compileElementNode(node, id, context, dependencies, metadata, diagnostics)
}

function compileTextNode(node: RComponentSFC_AST_TextNode, id: string): RComponentSFC_IR_Node | null {
  if (!node.content.trim()) {
    return null
  }

  return {
    id,
    kind: 'text',
    value: node.content,
    sourceRange: node.range,
  }
}

function compileInterpolationNode(
  node: RComponentSFC_AST_InterpolationNode,
  id: string,
  context: ComponentSFCTemplateCompileContext,
  diagnostics: RComponentDiagnostic[],
): RComponentSFC_IR_Node {
  const result = compileComponentSFCExpression(node.expression, {
    props: context.props,
    locals: context.locals,
    sourcePath: 'template',
  })
  diagnostics.push(...result.diagnostics)

  return {
    id,
    kind: 'expression',
    value: result.value,
    sourceRange: node.range,
  }
}

function compileElementNode(
  node: RComponentSFC_AST_ElementNode,
  id: string,
  context: ComponentSFCTemplateCompileContext,
  dependencies: RComponentDependencies,
  metadata: ProgramNodeMetadata[],
  diagnostics: RComponentDiagnostic[],
): RComponentSFC_IR_ElementNode | null {
  const isBuiltIn = isComponentSFCBuiltInTag(node.tag)
  const localComponentPort = isBuiltIn
    ? null
    : context.componentPorts?.find(port => port.tag === node.tag) ?? null
  const directComponentIdentity = isBuiltIn
    ? null
    : localComponentPort?.defaultIdentity
      ?? context.resolveComponentTag?.(node.tag)
      ?? null

  if (!isBuiltIn && !directComponentIdentity) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-template-component-tag-unknown',
      message: `Пользовательский SFC tag "${node.tag}" не зарегистрирован.`,
      sourcePath: 'template',
      start: node.range.start,
      end: node.range.end,
    })
    return null
  }

  const componentManifest = directComponentIdentity
    ? context.resolveComponentPortManifest?.(directComponentIdentity) ?? null
    : null
  const portBindings = directComponentIdentity
    ? compileRequiredPortBindings(node, componentManifest, context, dependencies, diagnostics)
    : []
  const portBindingRanges = new Set(portBindings.map(binding => `${binding.sourceRange?.start}:${binding.sourceRange?.end}`))
  const nodeMetadata = compileNodeMetadata(node.attributes, diagnostics, `template.${id}.metadata`)
  validateSemanticStyleAttributes(node.attributes, diagnostics, `template.${id}`)
  const props = compileAttributes(
    node.attributes.filter(attribute => (
      !['metadata', 'editable', 'edit-on', 'cancel-on', 'commit-on', 'on'].includes(attribute.name)
      && !portBindingRanges.has(`${attribute.range.start}:${attribute.range.end}`)
    )),
    context,
    diagnostics,
  )
  const directives = compileDirectives(node.directives.filter(directive => directive.name !== 'on'), context, diagnostics)
  const tag: RComponentSFC_IR_Tag = directComponentIdentity ? 'Component' : node.tag as RComponentSFC_IR_Tag
  const baseEventManifest = directComponentIdentity
    ? componentManifest
    : createBuiltInComponentPortManifest(tag)
  const editable = compileEditableBehavior(node, tag, props, context, diagnostics)
  const eventManifest = editable
    ? withEditableEventManifest(baseEventManifest)
    : baseEventManifest
  const events = compileEventBindings(node.directives, eventManifest, context.ownerPorts, dependencies, diagnostics)
  const interactions = compileInteractionBindings(node.attributes, eventManifest, context, dependencies, diagnostics)

  if (directComponentIdentity) {
    if (props.is) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-template-direct-component-is-reserved',
        message: `Атрибут is зарезервирован для <Component>; у прямого tag <${node.tag}> identity определяется registry.`,
        sourcePath: 'template',
        start: node.range.start,
        end: node.range.end,
      })
    }
    props.is = { kind: 'literal', value: directComponentIdentity }
  }

  if (tag === 'Component' && !localComponentPort) {
    validateComponentCall(props.is, context, dependencies, diagnostics, node)
  }

  const element: RComponentSFC_IR_ElementNode = {
    id,
    kind: 'element',
    tag,
    componentTag: directComponentIdentity ? node.tag : undefined,
    props,
    directives,
    events,
    ...(interactions.length ? { interactions } : {}),
    children: node.children
      .map((child, index) => compileTemplateNode(child, `${id}-${index}`, context, dependencies, metadata, diagnostics))
      .filter((child): child is RComponentSFC_IR_Node => child != null),
    sourceRange: node.range,
    port: localComponentPort
      ? {
          kind: 'component',
          port: localComponentPort.name,
          defaultIdentity: localComponentPort.defaultIdentity,
        }
      : undefined,
    ...(portBindings.length ? { portBindings } : {}),
    editable,
  }

  if (editable && element.tag === 'Component') {
    const identity = element.props.is?.kind === 'literal' ? String(element.props.is.value ?? '').trim() : ''
    const variants = identity ? context.resolveComponentVariants?.(identity) : null
    if (variants && !variants.includes('edit')) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-editable-component-variant-missing',
        message: `Component "${identity}" используется с editable, но не объявляет Variant name="edit".`,
        sourcePath: `template.${id}.editable`,
        start: node.range.start,
        end: node.range.end,
      })
    }
  }

  if (editable && !events.some(binding => binding.name === 'edited')) {
    events.push({
      name: 'edited',
      modifiers: [],
      action: { kind: 'emit', event: 'edited', payload: { kind: 'event', path: null } },
    })
  }

  validateNestedVariants(element, diagnostics, `template.${id}`)

  if (Object.keys(nodeMetadata).length > 0) {
    const staticKey = node.directives.find(directive => directive.name === 'key' && !directive.argument)
    const key = staticKey?.expression?.trim() || undefined
    metadata.push({
      nodeId: id,
      nodeKind: element.tag,
      key,
      values: nodeMetadata,
    })
  }

  if (element.tag === 'Table') {
    diagnostics.push(...normalizeComponentSFCTableSort(element).diagnostics)
    diagnostics.push(...normalizeComponentSFCTableColumnPin(element).diagnostics)
    diagnostics.push(...normalizeComponentSFCTableColumnVisibility(element).diagnostics)
  }

  return element
}

function compileRequiredPortBindings(
  node: RComponentSFC_AST_ElementNode,
  manifest: ComponentSFCPortManifest | null,
  context: ComponentSFCTemplateCompileContext,
  dependencies: RComponentDependencies,
  diagnostics: RComponentDiagnostic[],
): ComponentSFCRequiredPortBinding[] {
  if (!manifest) {
    return []
  }
  const ports = [
    ...manifest.require.computations,
    ...manifest.require.components,
    ...manifest.require.actions,
    ...manifest.require.queries,
  ]
  const byName = new Map(ports.map(port => [port.name, port]))
  const result: ComponentSFCRequiredPortBinding[] = []
  const seen = new Set<string>()

  for (const attribute of node.attributes) {
    const portName = normalizePublicBindingName(attribute.name)
    const port = byName.get(portName)
    if (!port) {
      continue
    }
    if (seen.has(portName)) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-template-port-binding-duplicate',
        message: `Required port "${portName}" переопределён на одном component call повторно.`,
        sourcePath: `template.ports.${portName}`,
        start: attribute.range.start,
        end: attribute.range.end,
      })
      continue
    }
    seen.add(portName)

    const binding = parseRequiredPortBinding(attribute, port.kind, diagnostics)
    if (!binding) {
      continue
    }
    const provider = context.resolvePortProvider?.(binding.identity, binding.kind)
    if (context.resolvePortProvider && !provider) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-template-port-provider-missing',
        message: `Provider "${binding.identity}" для required port "${portName}" не найден.`,
        sourcePath: `template.ports.${portName}`,
        start: attribute.range.start,
        end: attribute.range.end,
      })
      continue
    }
    if (provider && provider.kind !== port.kind) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-template-port-provider-kind',
        message: `Provider "${binding.identity}" имеет kind "${provider.kind}", required port "${portName}" ожидает "${port.kind}".`,
        sourcePath: `template.ports.${portName}`,
        start: attribute.range.start,
        end: attribute.range.end,
      })
      continue
    }
    if (provider && !provider.active) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-template-port-provider-inactive',
        message: `Provider "${binding.identity}" для required port "${portName}" неактивен.`,
        sourcePath: `template.ports.${portName}`,
        start: attribute.range.start,
        end: attribute.range.end,
      })
    }
    if (
      provider?.kind === 'query'
      && port.kind === 'query'
      && (
        hasTemplatePortFieldMismatch(port.inputs, provider.inputs)
        || (port.outputs.length > 0 && hasTemplatePortFieldMismatch(port.outputs, provider.outputs))
      )
    ) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-template-query-port-contract',
        message: `Query "${binding.identity}" не соответствует contract required port "${portName}".`,
        sourcePath: `template.ports.${portName}`,
        start: attribute.range.start,
        end: attribute.range.end,
      })
      continue
    }

    appendRequiredPortBindingDependency(binding, dependencies)
    result.push({ ...binding, port: portName, sourceRange: attribute.range })
  }
  return result
}

function parseRequiredPortBinding(
  attribute: RComponentSFC_AST_Attribute,
  expectedKind: ComponentSFCRequiredPortKind,
  diagnostics: RComponentDiagnostic[],
): Omit<ComponentSFCRequiredPortBinding, 'port'> | null {
  let expression: any
  try {
    expression = attribute.dynamic
      ? parseExpression(String(attribute.value ?? '').trim(), { sourceType: 'module', plugins: ['typescript'] })
      : null
  }
  catch {
    expression = null
  }
  const kind = expression?.type === 'CallExpression' && expression.callee?.type === 'Identifier'
    ? expression.callee.name as ComponentSFCRequiredPortKind
    : null
  const identity = expression?.arguments?.length === 1 && expression.arguments[0]?.type === 'StringLiteral'
    ? String(expression.arguments[0].value ?? '').trim()
    : ''
  if (!attribute.dynamic || !kind || !['action', 'component', 'computation', 'query'].includes(kind) || !identity) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-template-port-binding-shape',
      message: `Required port "${normalizePublicBindingName(attribute.name)}" переопределяется как ${expectedKind}('provider-identity').`,
      sourcePath: `template.ports.${normalizePublicBindingName(attribute.name)}`,
      start: attribute.range.start,
      end: attribute.range.end,
    })
    return null
  }
  if (kind !== expectedKind) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-template-port-binding-kind',
      message: `Required port "${normalizePublicBindingName(attribute.name)}" имеет kind "${expectedKind}" и не может быть связан через ${kind}(...).`,
      sourcePath: `template.ports.${normalizePublicBindingName(attribute.name)}`,
      start: attribute.range.start,
      end: attribute.range.end,
    })
    return null
  }
  return { kind, identity, sourceRange: attribute.range }
}

function appendRequiredPortBindingDependency(
  binding: Omit<ComponentSFCRequiredPortBinding, 'port'>,
  dependencies: RComponentDependencies,
): void {
  if (binding.kind === 'query') {
    dependencies.queries.push(binding.identity)
  }
  else if (binding.kind === 'action') {
    dependencies.actions.push(binding.identity)
  }
  else if (binding.kind === 'component') {
    dependencies.components.push({
      source: 'component-sfc',
      id: binding.identity,
      role: 'port-override-component',
    })
  }
  else {
    dependencies.computations.push({
      source: 'computation',
      id: binding.identity,
      role: 'port-override-computation',
    })
  }
}

function normalizePublicBindingName(value: string): string {
  return String(value ?? '').replace(/-([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase())
}

function hasTemplatePortFieldMismatch(
  expectedFields: Array<{ name: string, type: string, isArray?: boolean, optional?: boolean }>,
  actualFields: Array<{ name: string, type: string, isArray?: boolean, optional?: boolean }>,
): boolean {
  const expected = new Map(expectedFields.map(field => [field.name, field]))
  const actual = new Map(actualFields.map(field => [field.name, field]))
  return expectedFields.some((field) => {
    const candidate = actual.get(field.name)
    return !candidate
      || candidate.type.replace(/\s+/g, '') !== field.type.replace(/\s+/g, '')
      || Boolean(candidate.isArray) !== Boolean(field.isArray)
      || Boolean(candidate.optional) !== Boolean(field.optional)
  }) || actualFields.some(field => !field.optional && !expected.has(field.name))
}

/** Validates the lazy Tooltip compound shape after whitespace-only nodes have been removed. */
function validateTooltipTree(
  roots: RComponentSFC_IR_Node[],
  diagnostics: RComponentDiagnostic[],
): void {
  const visit = (
    node: RComponentSFC_IR_Node,
    parent: RComponentSFC_IR_ElementNode | null,
    insideTooltipContent: boolean,
  ): void => {
    if (node.kind !== 'element') {
      return
    }

    if ((node.tag === 'TooltipTrigger' || node.tag === 'TooltipContent') && parent?.tag !== 'Tooltip') {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-tooltip-structural-parent',
        message: `${node.tag} допускается только как прямой дочерний узел Tooltip.`,
        sourcePath: `template.${node.id}`,
        start: node.sourceRange?.start,
        end: node.sourceRange?.end,
      })
    }

    if (node.tag === 'Tooltip') {
      if (insideTooltipContent) {
        diagnostics.push({
          severity: 'error',
          code: 'sfc-tooltip-nested',
          message: 'Tooltip нельзя вкладывать в TooltipContent: один Shell управляет одним активным overlay.',
          sourcePath: `template.${node.id}`,
          start: node.sourceRange?.start,
          end: node.sourceRange?.end,
        })
      }
      validateTooltipNode(node, diagnostics)
    }

    for (const child of node.children) {
      visit(child, node, insideTooltipContent || node.tag === 'TooltipContent')
    }
  }
  roots.forEach(root => visit(root, null, false))
}

function validateTooltipNode(
  node: RComponentSFC_IR_ElementNode,
  diagnostics: RComponentDiagnostic[],
): void {
  const hasText = Object.hasOwn(node.props, 'text')
  const hasMarkdown = Object.hasOwn(node.props, 'markdown')
  const triggerNodes = node.children.filter((child): child is RComponentSFC_IR_ElementNode => (
    child.kind === 'element' && child.tag === 'TooltipTrigger'
  ))
  const contentNodes = node.children.filter((child): child is RComponentSFC_IR_ElementNode => (
    child.kind === 'element' && child.tag === 'TooltipContent'
  ))
  const usesCompound = triggerNodes.length > 0 || contentNodes.length > 0

  const report = (code: string, message: string): void => {
    diagnostics.push({
      severity: 'error',
      code,
      message,
      sourcePath: `template.${node.id}`,
      start: node.sourceRange?.start,
      end: node.sourceRange?.end,
    })
  }

  if (Number(hasText) + Number(hasMarkdown) + Number(usesCompound) !== 1) {
    report(
      'sfc-tooltip-mode',
      'Tooltip требует ровно один режим: text, markdown или TooltipTrigger + TooltipContent.',
    )
    return
  }

  if (hasText || hasMarkdown) {
    if (node.children.length === 0) {
      report('sfc-tooltip-trigger-required', 'Tooltip text/markdown требует trigger-содержимое.')
    }
    return
  }

  if (triggerNodes.length !== 1 || contentNodes.length !== 1 || node.children.length !== 2) {
    report(
      'sfc-tooltip-compound-shape',
      'Rich Tooltip требует ровно один TooltipTrigger и один TooltipContent без соседних узлов.',
    )
  }
  if (triggerNodes[0]?.children.length === 0) {
    report('sfc-tooltip-trigger-required', 'TooltipTrigger не может быть пустым.')
  }
  if (contentNodes[0]?.children.length === 0) {
    report('sfc-tooltip-content-required', 'TooltipContent не может быть пустым.')
  }
}

const LOCAL_EVENT_MODIFIERS = new Set<RComponentSFC_IR_EventModifier>([
  'stop',
  'prevent',
  'self',
  'once',
  'capture',
  'passive',
])

function compileEditableBehavior(
  node: RComponentSFC_AST_ElementNode,
  tag: RComponentSFC_IR_Tag,
  props: Record<string, RComponentSFC_IR_Value>,
  context: ComponentSFCTemplateCompileContext,
  diagnostics: RComponentDiagnostic[],
) {
  const editableAttribute = node.attributes.find(attribute => attribute.name === 'editable')
  const enabled = tag === 'Editable' || Boolean(editableAttribute)
  if (!enabled) {
    return undefined
  }

  if (editableAttribute?.dynamic || (editableAttribute?.value != null && editableAttribute.value !== '')) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-editable-static',
      message: 'editable является статическим boolean-атрибутом.',
      sourcePath: 'template.editable',
      start: editableAttribute.range.start,
      end: editableAttribute.range.end,
    })
  }

  let value = tag === 'Checkbox' ? props.checked : props.value
  if (!value && tag === 'Text') {
    const meaningful = node.children.filter(child => child.kind !== 'text' || child.content.trim())
    if (meaningful.length === 1 && meaningful[0]?.kind === 'interpolation') {
      const compiled = compileComponentSFCExpression(meaningful[0].expression, {
        props: context.props,
        locals: context.locals,
        sourcePath: 'template.editable.value',
      })
      diagnostics.push(...compiled.diagnostics)
      value = compiled.value
    }
    else if (meaningful.length > 0) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-editable-text-value',
        message: 'Text editable требует :value или ровно одну interpolation без смешанного текста.',
        sourcePath: 'template.editable.value',
        start: node.range.start,
        end: node.range.end,
      })
    }
  }
  if (!value) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-editable-value-required',
      message: `${tag} editable требует ${tag === 'Checkbox' ? 'checked' : 'value'}.`,
      sourcePath: 'template.editable.value',
      start: node.range.start,
      end: node.range.end,
    })
    value = { kind: 'literal', value: null }
  }

  const triggerAttribute = node.attributes.find(attribute => attribute.name === 'edit-on')
  let triggers: RComponentSFC_IR_Value = { kind: 'literal', value: 'click' }
  if (triggerAttribute?.dynamic) {
    const compiled = compileComponentSFCExpression(triggerAttribute.value ?? '', {
      props: context.props,
      locals: context.locals,
      sourcePath: 'template.edit-on',
    })
    diagnostics.push(...compiled.diagnostics)
    triggers = compiled.value
  }
  else if (triggerAttribute) {
    const event = String(triggerAttribute.value ?? '').trim()
    if (!event) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-edit-on-empty',
        message: 'edit-on требует непустое имя события.',
        sourcePath: 'template.edit-on',
        start: triggerAttribute.range.start,
        end: triggerAttribute.range.end,
      })
    }
    else {
      triggers = { kind: 'literal', value: event }
    }
  }

  const triggerModifiers: RComponentSFC_IR_EventModifier[] = []
  for (const modifier of triggerAttribute?.modifiers ?? []) {
    if (!LOCAL_EVENT_MODIFIERS.has(modifier as RComponentSFC_IR_EventModifier)) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-edit-on-modifier',
        message: `:edit-on не поддерживает modifier ".${modifier}".`,
        sourcePath: 'template.edit-on',
        start: triggerAttribute?.range.start,
        end: triggerAttribute?.range.end,
      })
      continue
    }
    triggerModifiers.push(modifier as RComponentSFC_IR_EventModifier)
  }
  if (triggerModifiers.includes('passive') && triggerModifiers.includes('prevent')) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-edit-on-passive-prevent',
      message: ':edit-on.passive нельзя объединять с .prevent.',
      sourcePath: 'template.edit-on',
      start: triggerAttribute?.range.start,
      end: triggerAttribute?.range.end,
    })
  }
  else if (triggerAttribute?.dynamic && hasComponentSFCPassivePreventConflict(triggerAttribute.value ?? '', triggerModifiers)) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-edit-on-passive-prevent',
      message: ':edit-on не может одновременно использовать passive и prevent.',
      sourcePath: 'template.edit-on',
      start: triggerAttribute.range.start,
      end: triggerAttribute.range.end,
    })
  }

  const cancel = compileEditableOutcomeTriggers(
    node,
    'cancel-on',
    context.sfcEditing?.cancelOn ?? DEFAULT_ENDGE_SFC_EDITING_CONFIGURATION.cancelOn,
    context,
    diagnostics,
  )
  const commit = compileEditableOutcomeTriggers(
    node,
    'commit-on',
    context.sfcEditing?.commitOn ?? DEFAULT_ENDGE_SFC_EDITING_CONFIGURATION.commitOn,
    context,
    diagnostics,
  )

  return {
    value,
    triggers,
    cancelTriggers: cancel.triggers,
    commitTriggers: commit.triggers,
    ...(triggerModifiers.length ? { modifiers: triggerModifiers } : {}),
    ...(cancel.modifiers.length ? { cancelModifiers: cancel.modifiers } : {}),
    ...(commit.modifiers.length ? { commitModifiers: commit.modifiers } : {}),
  }
}

function compileEditableOutcomeTriggers(
  node: RComponentSFC_AST_ElementNode,
  name: 'cancel-on' | 'commit-on',
  defaultValue: unknown,
  context: ComponentSFCTemplateCompileContext,
  diagnostics: RComponentDiagnostic[],
): { triggers: RComponentSFC_IR_Value, modifiers: RComponentSFC_IR_EventModifier[] } {
  const attribute = node.attributes.find(item => item.name === name)
  let triggers: RComponentSFC_IR_Value = { kind: 'literal', value: defaultValue }
  if (attribute?.dynamic) {
    const compiled = compileComponentSFCExpression(attribute.value ?? '', {
      props: context.props,
      locals: context.locals,
      sourcePath: `template.${name}`,
    })
    diagnostics.push(...compiled.diagnostics)
    triggers = compiled.value
  }
  else if (attribute) {
    const event = String(attribute.value ?? '').trim()
    if (!event) {
      diagnostics.push({
        severity: 'error',
        code: `sfc-${name}-empty`,
        message: `${name} требует непустое имя события.`,
        sourcePath: `template.${name}`,
        start: attribute.range.start,
        end: attribute.range.end,
      })
    }
    else {
      triggers = { kind: 'literal', value: event }
    }
  }

  const modifiers: RComponentSFC_IR_EventModifier[] = []
  for (const modifier of attribute?.modifiers ?? []) {
    if (!LOCAL_EVENT_MODIFIERS.has(modifier as RComponentSFC_IR_EventModifier)) {
      diagnostics.push({
        severity: 'error',
        code: `sfc-${name}-modifier`,
        message: `:${name} не поддерживает modifier ".${modifier}".`,
        sourcePath: `template.${name}`,
        start: attribute?.range.start,
        end: attribute?.range.end,
      })
      continue
    }
    modifiers.push(modifier as RComponentSFC_IR_EventModifier)
  }
  if (
    (modifiers.includes('passive') && modifiers.includes('prevent'))
    || (attribute?.dynamic && hasComponentSFCPassivePreventConflict(attribute.value ?? '', modifiers))
  ) {
    diagnostics.push({
      severity: 'error',
      code: `sfc-${name}-passive-prevent`,
      message: `:${name} не может одновременно использовать passive и prevent.`,
      sourcePath: `template.${name}`,
      start: attribute?.range.start,
      end: attribute?.range.end,
    })
  }
  return { triggers, modifiers }
}

function withEditableEventManifest(manifest: ComponentSFCPortManifest | null): ComponentSFCPortManifest {
  const result = manifest
    ? {
        ...manifest,
        emits: { events: [...manifest.emits.events] },
      }
    : createEmptyComponentSFCPortManifest()
  if (!result.emits.events.some(event => event.name === 'edited')) {
    result.emits.events.push({
      kind: 'event',
      role: 'emits',
      name: 'edited',
      payloadType: 'unknown',
    })
  }
  return result
}

function validateNestedVariants(
  node: RComponentSFC_IR_ElementNode,
  diagnostics: RComponentDiagnostic[],
  sourcePath: string,
): void {
  if (node.tag === 'Editable') {
    validateVariantContainer(node.children, diagnostics, sourcePath, true)
  }
  for (const child of node.children) {
    if (child.kind === 'element') {
      validateNestedVariants(child, diagnostics, `${sourcePath}.${child.id}`)
    }
  }
}

function validateVariantContainer(
  nodes: RComponentSFC_IR_Node[],
  diagnostics: RComponentDiagnostic[],
  sourcePath: string,
  requireEdit: boolean,
): ComponentSFCVariant[] {
  const variantNodes = nodes.filter((node): node is RComponentSFC_IR_ElementNode => node.kind === 'element' && node.tag === 'Variant')
  if (!variantNodes.length) {
    if (requireEdit) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-editable-variants-required',
        message: 'Editable требует Variant name="default" и Variant name="edit".',
        sourcePath,
      })
    }
    return []
  }
  if (variantNodes.length !== nodes.length) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-variant-roots-only',
      message: 'При явных Variant все соседние корневые узлы контейнера должны быть Variant.',
      sourcePath,
    })
  }
  const result: ComponentSFCVariant[] = []
  const names = new Set<string>()
  for (const variant of variantNodes) {
    const name = variant.props.name?.kind === 'literal' ? String(variant.props.name.value ?? '').trim() : ''
    if (!name || names.has(name)) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-variant-name',
        message: 'Variant name должен быть статическим, непустым и уникальным.',
        sourcePath,
        start: variant.sourceRange?.start,
        end: variant.sourceRange?.end,
      })
      continue
    }
    names.add(name)
    result.push({ name, nodeId: variant.id })
  }
  if (!names.has('default')) {
    diagnostics.push({ severity: 'error', code: 'sfc-variant-default-required', message: 'Явные Variant требуют ровно один name="default".', sourcePath })
  }
  if (requireEdit && !names.has('edit')) {
    diagnostics.push({ severity: 'error', code: 'sfc-variant-edit-required', message: 'Editable требует Variant name="edit".', sourcePath })
  }
  return result
}

function collectTemplateEmittedEvents(nodes: RComponentSFC_IR_Node[]): string[] {
  const result = new Set<string>()
  const visit = (node: RComponentSFC_IR_Node): void => {
    if (node.kind !== 'element') {
      return
    }
    if (node.editable) {
      result.add('edited')
    }
    for (const binding of node.events ?? []) {
      if (binding.action.kind === 'emit') {
        result.add(binding.action.event)
      }
      for (const action of binding.actions ?? []) {
        if (action.kind === 'emit') {
          result.add(action.event)
        }
      }
    }
    for (const group of node.interactions ?? []) {
      for (const reaction of group.triggerSet?.reactions ?? []) {
        if (reaction.kind === 'emit') {
          result.add(reaction.event)
        }
      }
      for (const rule of group.rules) {
        for (const reaction of rule.reactions) {
          if (reaction.kind === 'emit') {
            result.add(reaction.event)
          }
        }
      }
    }
    node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return [...result]
}

function compileInteractionBindings(
  attributes: RComponentSFC_AST_Attribute[],
  manifest: ComponentSFCPortManifest | null,
  context: ComponentSFCTemplateCompileContext,
  dependencies: RComponentDependencies,
  diagnostics: RComponentDiagnostic[],
): RComponentSFC_IR_InteractionGroup[] {
  return attributes
    .filter(attribute => attribute.name === 'on')
    .flatMap((attribute) => {
      const group = compileComponentSFCInteractionAnnotation(attribute, manifest, context, dependencies, diagnostics, context.ownerPorts)
      return group ? [group] : []
    })
}
function compileEventBindings(
  directives: RComponentSFC_AST_Directive[],
  manifest: ComponentSFCPortManifest | null,
  ownerPorts: ComponentSFCPortManifest | null | undefined,
  dependencies: RComponentDependencies,
  diagnostics: RComponentDiagnostic[],
): RComponentSFC_IR_EventBinding[] {
  const result: RComponentSFC_IR_EventBinding[] = []
  for (const directive of directives.filter(item => item.name === 'on')) {
    const name = directive.argument?.trim() ?? ''
    const available = manifest?.emits.events.find(event => event.name === name)
    if (!name || !available) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-template-event-unknown',
        message: name
          ? `Event "${name}" не объявлен source-тегом.`
          : 'Event binding требует static имя, например `@click`.',
        sourcePath: 'template.on',
        start: directive.range.start,
        end: directive.range.end,
      })
      continue
    }
    const modifiers: RComponentSFC_IR_EventModifier[] = []
    let invalid = false
    for (const modifier of directive.modifiers ?? []) {
      if (!LOCAL_EVENT_MODIFIERS.has(modifier as RComponentSFC_IR_EventModifier)) {
        diagnostics.push({
          severity: 'error',
          code: 'sfc-template-event-modifier',
          message: `@${name} не поддерживает modifier ".${modifier}".`,
          sourcePath: `template.on.${name}`,
          start: directive.range.start,
          end: directive.range.end,
        })
        invalid = true
      }
      else if (!modifiers.includes(modifier as RComponentSFC_IR_EventModifier)) {
        modifiers.push(modifier as RComponentSFC_IR_EventModifier)
      }
    }
    if (modifiers.includes('passive') && modifiers.includes('prevent')) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-template-event-passive-prevent',
        message: `@${name}.passive нельзя объединять с .prevent.`,
        sourcePath: `template.on.${name}`,
        start: directive.range.start,
        end: directive.range.end,
      })
      invalid = true
    }
    const expression = directive.expression?.trim() ?? ''
    if (invalid || !expression) {
      if (!expression) {
        diagnostics.push({
          severity: 'error',
          code: 'sfc-template-event-action-missing',
          message: `@${name} требует локальную reaction.`,
          sourcePath: `template.on.${name}`,
          start: directive.range.start,
          end: directive.range.end,
        })
      }
      continue
    }
    const actions = compileComponentSFCLocalEventActions(name, expression, directive.range.start, dependencies, diagnostics, ownerPorts)
    if (!actions.length) {
      continue
    }
    result.push({
      name,
      modifiers,
      action: actions[0]!,
      ...(actions.length > 1 ? { actions } : {}),
      sourceRange: directive.range,
    })
  }
  return result
}

function validateSemanticStyleAttributes(
  attributes: RComponentSFC_AST_Attribute[],
  diagnostics: RComponentDiagnostic[],
  sourcePath: string,
): void {
  const part = attributes.find(attribute => attribute.name === 'part')
  if (!part) {
    return
  }
  const valid = !part.dynamic
    && typeof part.value === 'string'
    && part.value.trim().length > 0
    && part.value.trim().split(/\s+/).every(token => /^[a-z][\w-]*$/i.test(token))
  if (!valid) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-template-part-static',
      message: 'part must be a static whitespace-separated token list.',
      sourcePath: `${sourcePath}.part`,
      start: part.range.start,
      end: part.range.end,
    })
  }
}

function validateComponentCall(
  value: RComponentSFC_IR_Value | undefined,
  context: ComponentSFCTemplateCompileContext,
  dependencies: RComponentDependencies,
  diagnostics: RComponentDiagnostic[],
  node: RComponentSFC_AST_ElementNode,
): void {
  if (!value) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-template-component-is-required',
      message: 'Component должен содержать is с identity компонента.',
      sourcePath: 'template',
      start: node.range.start,
      end: node.range.end,
    })
    return
  }

  if (value.kind !== 'literal') {
    return
  }
  const identity = typeof value.value === 'string' ? value.value.trim() : ''
  if (!identity) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-template-component-is-invalid',
      message: 'Статический Component is должен содержать непустую identity.',
      sourcePath: 'template',
      start: node.range.start,
      end: node.range.end,
    })
    return
  }

  if (context.hasComponentIdentity && !context.hasComponentIdentity(identity)) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-template-component-missing',
      message: `SFC-компонент с identity "${identity}" не найден.`,
      sourcePath: 'template',
      start: node.range.start,
      end: node.range.end,
    })
  }

  collectComponentDependency({ kind: 'literal', value: identity }, dependencies)
}

function compileNodeMetadata(
  attributes: RComponentSFC_AST_Attribute[],
  diagnostics: RComponentDiagnostic[],
  sourcePath: string,
) {
  const declarations = attributes.filter(attribute => attribute.name === 'metadata')
  if (declarations.length === 0) {
    return {}
  }

  if (declarations.length > 1) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-template-metadata-duplicate',
      message: 'Template-узел допускает только один атрибут metadata.',
      sourcePath,
      start: declarations[1].range.start,
      end: declarations[1].range.end,
    })
  }

  const declaration = declarations[0]
  if (!declaration.dynamic || !declaration.value) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-template-metadata-shape',
      message: 'Metadata template-узла должна быть статическим object literal в :metadata.',
      sourcePath,
      start: declaration.range.start,
      end: declaration.range.end,
    })
    return {}
  }

  return compileProgramMetadataSource(declaration.value, diagnostics, sourcePath)
}

function compileAttributes(
  attributes: RComponentSFC_AST_Attribute[],
  context: ComponentSFCTemplateCompileContext,
  diagnostics: RComponentDiagnostic[],
): Record<string, RComponentSFC_IR_Value> {
  const props: Record<string, RComponentSFC_IR_Value> = {}

  for (const attribute of attributes) {
    if (attribute.dynamic) {
      const result = compileComponentSFCExpression(attribute.value ?? '', {
        props: context.props,
        locals: context.locals,
        sourcePath: `template.${attribute.name}`,
      })
      props[attribute.name] = result.value
      diagnostics.push(...result.diagnostics)
    }
    else {
      props[attribute.name] = {
        kind: 'literal',
        value: attribute.value ?? true,
      }
    }
  }

  return props
}

function compileDirectives(
  directives: RComponentSFC_AST_Directive[],
  context: ComponentSFCTemplateCompileContext,
  diagnostics: RComponentDiagnostic[],
): RComponentSFC_IR_Directives {
  const result: RComponentSFC_IR_Directives = {}

  for (const directive of directives) {
    if (directive.name === 'else') {
      result.else = true
      continue
    }

    const value = compileDirectiveExpression(directive, context, diagnostics)
    if (directive.name === 'if') {
      result.if = value
    }
    if (directive.name === 'else-if') {
      result.elseIf = value
    }
    if (directive.name === 'key') {
      result.key = value
    }
    if (directive.name === 'for') {
      result.for = parseForDirective(directive, value)
    }
  }

  return result
}

function compileDirectiveExpression(
  directive: RComponentSFC_AST_Directive,
  context: ComponentSFCTemplateCompileContext,
  diagnostics: RComponentDiagnostic[],
): RComponentSFC_IR_Value {
  const result = compileComponentSFCExpression(directive.expression ?? '', {
    props: context.props,
    locals: context.locals,
    sourcePath: `template.${directive.name}`,
  })
  diagnostics.push(...result.diagnostics)
  return result.value
}

function parseForDirective(
  directive: RComponentSFC_AST_Directive,
  source: RComponentSFC_IR_Value,
): RComponentSFC_IR_Directives['for'] {
  const expression = directive.expression ?? ''
  const match = expression.match(/^\s*(?:\(([^,\s]+)\s*,\s*(\S[^)]*)\)|(\S+))\s+in\s+(\S.*)$/)

  if (!match) {
    return {
      item: 'item',
      source,
    }
  }

  return {
    item: match[1] ?? match[3] ?? 'item',
    index: match[2]?.trim(),
    source: {
      kind: 'expression',
      source: match[4]?.trim() ?? expression,
      reads: source.kind === 'expression' ? source.reads : [],
    },
  }
}

function collectComponentDependency(value: RComponentSFC_IR_Value | undefined, dependencies: RComponentDependencies): void {
  if (!value || value.kind !== 'literal' || typeof value.value !== 'string' || !value.value.trim()) {
    return
  }

  dependencies.components.push({
    source: 'component-sfc',
    id: value.value,
  })
}
