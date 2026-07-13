import type { RComponentDependencies, RComponentDiagnostic } from '@/domain/types/component-core.types'
import { createEmptyComponentDependencies } from '@/domain/types/component-core.types'
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
} from '@/domain/types/component-sfc.types'
import { compileComponentSFCExpression } from '@/domain/services/compiler/component-sfc-expression'
import { normalizeComponentSFCTableColumnMenu } from '@/domain/services/compiler/component-sfc-table-menu'
import { normalizeComponentSFCTableColumnPin } from '@/domain/services/compiler/component-sfc-table-pin'
import { normalizeComponentSFCTableSort } from '@/domain/services/compiler/component-sfc-table-sort'

/** Контекст компиляции template в IR. */
export interface ComponentSFCTemplateCompileContext {
  /** Имена props для классификации expression reads. */
  props: string[]

  /** Имена locals для классификации expression reads. */
  locals: string[]
}

/** Результат компиляции template в IR. */
export interface ComponentSFCTemplateCompileResult {
  /** IR template или null, если template отсутствует. */
  template: RComponentSFC_IR_Template | null

  /** Зависимости, найденные в template. */
  dependencies: RComponentDependencies

  /** Diagnostics template pass. */
  diagnostics: RComponentDiagnostic[]
}

const ALLOWED_TAGS = new Set<RComponentSFC_IR_Tag>([
  'Text',
  'DateTime',
  'Number',
  'Icon',
  'Badge',
  'Dot',
  'Box',
  'Flex',
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

/** Компилирует AST template в renderer-neutral Endge SFC IR. */
export function compileComponentSFCTemplate(
  template: RComponentSFC_AST_Template | null,
  context: ComponentSFCTemplateCompileContext,
): ComponentSFCTemplateCompileResult {
  const diagnostics: RComponentDiagnostic[] = []
  const dependencies = createEmptyComponentDependencies()

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
      diagnostics,
    }
  }

  return {
    template: {
      roots: template.roots
        .map((node, index) => compileTemplateNode(node, `root-${index}`, context, dependencies, diagnostics))
        .filter((node): node is RComponentSFC_IR_Node => node != null),
    },
    dependencies,
    diagnostics,
  }
}

function compileTemplateNode(
  node: RComponentSFC_AST_TemplateNode,
  id: string,
  context: ComponentSFCTemplateCompileContext,
  dependencies: RComponentDependencies,
  diagnostics: RComponentDiagnostic[],
): RComponentSFC_IR_Node | null {
  if (node.kind === 'text')
    return compileTextNode(node, id)

  if (node.kind === 'interpolation')
    return compileInterpolationNode(node, id, context, diagnostics)

  return compileElementNode(node, id, context, dependencies, diagnostics)
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
  diagnostics: RComponentDiagnostic[],
): RComponentSFC_IR_ElementNode | null {
  if (!ALLOWED_TAGS.has(node.tag as RComponentSFC_IR_Tag)) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-template-tag-unsupported',
      message: `SFC template tag "${node.tag}" не поддерживается в v1.`,
      sourcePath: 'template',
      start: node.range.start,
      end: node.range.end,
    })
    return null
  }

  const props = compileAttributes(node.attributes, context, diagnostics)
  const directives = compileDirectives(node.directives, context, diagnostics)

  if (node.tag === 'Component')
    collectComponentDependency(props.is, dependencies)

  const element: RComponentSFC_IR_ElementNode = {
    id,
    kind: 'element',
    tag: node.tag as RComponentSFC_IR_Tag,
    props,
    directives,
    children: node.children
      .map((child, index) => compileTemplateNode(child, `${id}-${index}`, context, dependencies, diagnostics))
      .filter((child): child is RComponentSFC_IR_Node => child != null),
    sourceRange: node.range,
  }

  if (element.tag === 'Table') {
    diagnostics.push(...normalizeComponentSFCTableSort(element).diagnostics)
    diagnostics.push(...normalizeComponentSFCTableColumnPin(element).diagnostics)
    diagnostics.push(...normalizeComponentSFCTableColumnMenu(element).diagnostics)
  }

  return element
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
