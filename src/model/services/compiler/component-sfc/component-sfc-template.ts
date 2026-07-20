import type { RComponentDependencies, RComponentDiagnostic } from '@/domain/types/component/component-core.types'
import { createEmptyComponentDependencies } from '@/domain/types/component/component-core.types'
import type {
  RComponentSFC_AST_Attribute,
  RComponentSFC_AST_Directive,
  RComponentSFC_AST_ElementNode,
  RComponentSFC_AST_InterpolationNode,
  RComponentSFC_AST_Template,
  RComponentSFC_AST_TemplateNode,
  RComponentSFC_AST_TextNode,
  RComponentSFC_IR_Directives,
  RComponentSFC_IR_ElementNode,
  RComponentSFC_IR_Node,
  RComponentSFC_IR_Tag,
  RComponentSFC_IR_Template,
  RComponentSFC_IR_Value,
  ComponentSFCComponentPort,
  ComponentSFCActionPort,
} from '@/domain/types/component/sfc'
import type { ProgramNodeMetadata } from '@/domain/types/program/program-metadata.types'
import { compileComponentSFCExpression } from '@/model/services/compiler/component-sfc/component-sfc-expression'
import { normalizeComponentSFCTableColumnMenu } from '@/model/services/compiler/component-sfc/component-sfc-table-menu'
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

  /** Actions exposed by this component and available to declarative handlers. */
  providedActions?: ComponentSFCActionPort[]

  /** Разрешает зарегистрированный пользовательский tag в identity компонента. */
  resolveComponentTag?: (tag: string) => string | null

  /** Проверяет статическую identity из Component is. */
  hasComponentIdentity?: (identity: string) => boolean
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
}

const ENDGE_SFC_BUILT_IN_TAGS = new Set<RComponentSFC_IR_Tag>([
  'Text',
  'DateTime',
  'Number',
  'Icon',
  'Badge',
  'Dot',
  'Box',
  'Flex',
  'Grid',
  'Divider',
  'Input',
  'Textarea',
  'Checkbox',
  'Select',
  'Component',
  'Table',
  'Column',
  'Cell',
  'ColumnMenu',
  'MenuItem',
  'MenuSeparator',
])

/** Проверяет, является ли tag встроенным renderer-neutral SFC primitive. */
export function isComponentSFCBuiltInTag(tag: string): tag is RComponentSFC_IR_Tag {
  return ENDGE_SFC_BUILT_IN_TAGS.has(tag as RComponentSFC_IR_Tag)
}

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
    }
  }

  return {
    template: {
      roots: template.roots
        .map((node, index) => compileTemplateNode(node, `root-${index}`, context, dependencies, metadata, diagnostics))
        .filter((node): node is RComponentSFC_IR_Node => node != null),
    },
    dependencies,
    metadata,
    diagnostics,
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
  if (node.kind === 'text')
    return compileTextNode(node, id)

  if (node.kind === 'interpolation')
    return compileInterpolationNode(node, id, context, diagnostics)

  return compileElementNode(node, id, context, dependencies, metadata, diagnostics)
}

function compileTextNode(node: RComponentSFC_AST_TextNode, id: string): RComponentSFC_IR_Node | null {
  if (!node.content.trim())
    return null

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

  const nodeMetadata = compileNodeMetadata(node.attributes, diagnostics, `template.${id}.metadata`)
  validateSemanticStyleAttributes(node.attributes, diagnostics, `template.${id}`)
  const props = compileAttributes(
    node.attributes.filter(attribute => attribute.name !== 'metadata'),
    context,
    diagnostics,
  )
  const directives = compileDirectives(node.directives, context, diagnostics)
  const tag: RComponentSFC_IR_Tag = directComponentIdentity ? 'Component' : node.tag as RComponentSFC_IR_Tag

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

  if (tag === 'Component' && !localComponentPort)
    validateComponentCall(props.is, context, dependencies, diagnostics, node)

  const element: RComponentSFC_IR_ElementNode = {
    id,
    kind: 'element',
    tag,
    componentTag: directComponentIdentity ? node.tag : undefined,
    props,
    directives,
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
  }

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
    const menu = normalizeComponentSFCTableColumnMenu(element, context.providedActions)
    diagnostics.push(...menu.diagnostics)
  }

  return element
}

function validateSemanticStyleAttributes(
  attributes: RComponentSFC_AST_Attribute[],
  diagnostics: RComponentDiagnostic[],
  sourcePath: string,
): void {
  const part = attributes.find(attribute => attribute.name === 'part')
  if (!part) return
  const valid = !part.dynamic
    && typeof part.value === 'string'
    && part.value.trim().length > 0
    && part.value.trim().split(/\s+/).every(token => /^[a-zA-Z][\w-]*$/.test(token))
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

  if (value.kind !== 'literal') return
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
  if (declarations.length === 0)
    return {}

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
    if (directive.name === 'if')
      result.if = value
    if (directive.name === 'else-if')
      result.elseIf = value
    if (directive.name === 'key')
      result.key = value
    if (directive.name === 'for')
      result.for = parseForDirective(directive, value)
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
  const match = expression.match(/^\s*(?:\(([^,\s]+)\s*,\s*([^)]+)\)|([^\s]+))\s+in\s+(.+)$/)

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
  if (!value || value.kind !== 'literal' || typeof value.value !== 'string' || !value.value.trim())
    return

  dependencies.components.push({
    source: 'component-sfc',
    id: value.value,
  })
}
