import type {
  ComponentSFCVisualAttribute,
  ComponentSFCVisualInspection,
  ComponentSFCVisualInspectionOptions,
  ComponentSFCVisualSourceValue,
  ComponentSFCTableColumnProjection,
  ComponentSFCTableVisualCellTag,
  ComponentSFCTableVisualProjection,
  RComponentSFC_AST_Directive,
  RComponentSFC_AST_ElementNode,
  RComponentSFC_AST_TemplateNode,
  RComponentSFC_IR_ElementNode,
  RComponentSFC_IR_Value,
} from '@/domain/types/component/sfc'
import { compileComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-compile'
import { isComponentSFCBuiltInTag } from '@/model/services/compiler/component-sfc/component-sfc-template'

const NON_VISUAL_CELL_TAGS = new Set([
  'Component',
  'Table',
  'Column',
  'Cell',
  'ColumnMenu',
  'MenuItem',
  'MenuSeparator',
])

/** Строит UI-neutral visual projection только для SFC с одним корневым Table. */
export function inspectComponentSFCVisual(
  source: string,
  options: ComponentSFCVisualInspectionOptions = {},
): ComponentSFCVisualInspection {
  const compileResult = compileComponentSFC(source, {
    resolveComponentTag: options.resolveComponentTag,
  })
  const template = compileResult.ast?.template

  if (!source.trim()) {
    return {
      support: { kind: 'none', reason: 'source-empty' },
      projection: null,
      diagnostics: compileResult.diagnostics,
    }
  }

  if (!template) {
    return {
      support: { kind: 'none', reason: 'template-missing' },
      projection: null,
      diagnostics: compileResult.diagnostics,
    }
  }

  const roots = template.roots.filter(isSemanticRoot)
  if (roots.length !== 1) {
    return {
      support: { kind: 'none', reason: 'root-count' },
      projection: null,
      diagnostics: compileResult.diagnostics,
    }
  }

  const root = roots[0]
  if (root.kind !== 'element' || root.tag !== 'Table') {
    return {
      support: { kind: 'none', reason: 'root-not-table' },
      projection: null,
      diagnostics: compileResult.diagnostics,
    }
  }

  const irRoot = compileResult.ir?.template.roots.find(
    (node): node is RComponentSFC_IR_ElementNode => node.kind === 'element' && node.tag === 'Table',
  ) ?? null

  return {
    support: { kind: 'table' },
    projection: projectTable(source, root, irRoot),
    diagnostics: compileResult.diagnostics,
  }
}

function isSemanticRoot(node: RComponentSFC_AST_TemplateNode): boolean {
  return node.kind !== 'text' || Boolean(node.content.trim())
}

function projectTable(
  source: string,
  ast: RComponentSFC_AST_ElementNode,
  ir: RComponentSFC_IR_ElementNode | null,
): ComponentSFCTableVisualProjection {
  const astColumns = ast.children.filter(
    (node): node is RComponentSFC_AST_ElementNode => node.kind === 'element' && node.tag === 'Column',
  )
  const irColumns = ir?.children.filter(
    (node): node is RComponentSFC_IR_ElementNode => node.kind === 'element' && node.tag === 'Column',
  ) ?? []

  return {
    kind: 'table',
    rows: readProp(ir, 'rows'),
    rowKey: readProp(ir, 'row-key', 'rowKey'),
    paging: readProp(ir, 'paging'),
    pageSize: readProp(ir, 'page-size', 'pageSize'),
    pageSizes: readProp(ir, 'page-sizes', 'pageSizes'),
    sortMode: readProp(ir, 'sort-mode', 'sortMode'),
    defaultSort: readProp(ir, 'default-sort', 'defaultSort'),
    columnPin: readProp(ir, 'column-pin', 'columnPin'),
    defaultPin: readProp(ir, 'default-pin', 'defaultPin'),
    defaultHidden: readProp(ir, 'default-hidden', 'defaultHidden'),
    columnMenu: readProp(ir, 'column-menu', 'columnMenu'),
    attributes: projectAttributes(source, ast, ir),
    columns: astColumns.map((column, index) => projectColumn(source, column, irColumns[index] ?? null, index)),
    sourceRange: ast.range,
  }
}

function projectColumn(
  source: string,
  ast: RComponentSFC_AST_ElementNode,
  ir: RComponentSFC_IR_ElementNode | null,
  index: number,
): ComponentSFCTableColumnProjection {
  const keyDirective = ast.directives.find(directive => directive.name === 'key')
  const key = keyDirective && ir?.directives.key
    ? readKeyDirective(source, keyDirective, ir.directives.key)
    : readDirectiveValue(ast.directives, 'key')
  const cellNode = ast.children.find(
    (node): node is RComponentSFC_AST_ElementNode => node.kind === 'element' && node.tag === 'Cell',
  ) ?? null
  const cell = projectColumnCell(source, ast, ir, cellNode)
  const stableKey = valueLabel(key).trim()

  return {
    id: `${stableKey || 'column'}:${index}`,
    index,
    key,
    title: readProp(ir, 'title'),
    width: readProp(ir, 'width'),
    sortable: readProp(ir, 'sortable'),
    sort: readProp(ir, 'sort'),
    sortBy: readProp(ir, 'sort-by', 'sortBy'),
    pinnable: readProp(ir, 'pinnable'),
    attributes: projectAttributes(source, ast, ir),
    cell: cell.projection,
    hasCustomCell: cell.hasCustomCell,
    cellSource: cell.source,
    sourceRange: ast.range,
  }
}

interface ProjectedColumnCell {
  projection: ComponentSFCTableColumnProjection['cell']
  hasCustomCell: boolean
  source: string | null
}

function projectColumnCell(
  source: string,
  column: RComponentSFC_AST_ElementNode,
  irColumn: RComponentSFC_IR_ElementNode | null,
  cell: RComponentSFC_AST_ElementNode | null,
): ProjectedColumnCell {
  if (cell) {
    return {
      projection: projectManagedCell(source, cell),
      hasCustomCell: true,
      source: source.slice(cell.range.start, cell.range.end),
    }
  }

  const children = column.children.filter(isSemanticRoot)
  if (children.length === 0) {
    return {
      projection: { kind: 'default' },
      hasCustomCell: false,
      source: null,
    }
  }

  const directSource = source.slice(children[0].range.start, children.at(-1)!.range.end)
  const child = children.length === 1 && children[0].kind === 'element'
    ? children[0]
    : null
  const irChild = child
    ? irColumn?.children.find(node => node.sourceRange?.start === child.range.start) ?? null
    : null
  const identity = irChild?.kind === 'element' && irChild.tag === 'Component'
    ? readLiteralString(irChild.props.is)
    : null

  return {
    projection: projectSingleCellElement(
      source,
      column,
      child,
      identity,
      'direct',
    ),
    hasCustomCell: true,
    source: directSource,
  }
}

function projectAttributes(
  source: string,
  ast: RComponentSFC_AST_ElementNode,
  ir: RComponentSFC_IR_ElementNode | null,
): ComponentSFCVisualAttribute[] {
  const attributes = ast.attributes.map(attribute => ({
    name: attribute.name,
    value: ir?.props[attribute.name]
      ? toVisualValue(ir.props[attribute.name])
      : attribute.dynamic
        ? { kind: 'expression' as const, source: attribute.value ?? '' }
        : attribute.value == null
          ? { kind: 'boolean' as const, value: true }
          : { kind: 'literal' as const, value: attribute.value },
    sourceRange: attribute.range,
  }))

  for (const directive of ast.directives) {
    attributes.push({
      name: directive.name,
      value: directive.name === 'key' && ir?.directives.key
        ? readKeyDirective(source, directive, ir.directives.key)
        : readDirective(directive),
      sourceRange: directive.range,
    })
  }

  return attributes
}

function projectManagedCell(
  source: string,
  cell: RComponentSFC_AST_ElementNode | null,
): ComponentSFCTableColumnProjection['cell'] {
  if (!cell)
    return { kind: 'default' }

  if (source.slice(cell.range.start, cell.range.end).includes('<!--'))
    return { kind: 'source' }

  const children = cell.children.filter(isSemanticRoot)
  if (children.length === 0)
    return { kind: 'component', identity: null, syntax: 'cell', bindings: [] }

  const child = children.length === 1 && children[0].kind === 'element'
    ? children[0]
    : null
  if (!child)
    return { kind: 'source' }

  if (child.tag !== 'Component') {
    return isVisualCellTag(child.tag)
      ? {
          kind: 'tag',
          tag: child.tag,
          syntax: 'cell',
          bindings: projectCellBindings(child),
        }
      : { kind: 'source' }
  }

  const identity = child.attributes.find(attribute => attribute.name === 'is')
  if (identity?.dynamic)
    return { kind: 'source' }

  const hasDynamicIs = child.directives.some((directive) => {
    const raw = source.slice(directive.range.start, directive.range.end).trim()
    return directive.name === 'bind' && directive.argument === 'is'
      || raw.startsWith(':is')
      || raw.startsWith('v-bind:is')
  })
  if (hasDynamicIs)
    return { kind: 'source' }

  return {
    kind: 'component',
    identity: identity?.value?.trim() || null,
    syntax: 'cell',
    bindings: projectCellBindings(child, new Set(['is'])),
  }
}

function projectSingleCellElement(
  source: string,
  owner: RComponentSFC_AST_ElementNode,
  child: RComponentSFC_AST_ElementNode | null,
  componentIdentity: string | null,
  syntax: 'cell' | 'direct',
): ComponentSFCTableColumnProjection['cell'] {
  if (!child || source.slice(owner.range.start, owner.range.end).includes('<!--'))
    return { kind: 'source' }
  if (componentIdentity)
    return {
      kind: 'component',
      identity: componentIdentity,
      syntax,
      bindings: projectCellBindings(child, new Set(['is'])),
    }
  if (isVisualCellTag(child.tag))
    return {
      kind: 'tag',
      tag: child.tag,
      syntax,
      bindings: projectCellBindings(child),
    }
  return { kind: 'source' }
}

/** Проецирует только props управляемого элемента, не затрагивая его children. */
function projectCellBindings(
  node: RComponentSFC_AST_ElementNode,
  excludedNames: ReadonlySet<string> = new Set(),
): ComponentSFCVisualAttribute[] {
  return node.attributes
    .filter(attribute => !excludedNames.has(attribute.name))
    .map(attribute => ({
      name: attribute.name,
      value: attribute.dynamic
        ? { kind: 'expression' as const, source: attribute.value ?? '' }
        : attribute.value == null
          ? { kind: 'boolean' as const, value: true }
          : { kind: 'literal' as const, value: attribute.value },
      sourceRange: attribute.range,
    }))
}

function isVisualCellTag(tag: string): tag is ComponentSFCTableVisualCellTag {
  return isComponentSFCBuiltInTag(tag) && !NON_VISUAL_CELL_TAGS.has(tag)
}

function readLiteralString(value: RComponentSFC_IR_Value | undefined): string | null {
  return value?.kind === 'literal' && typeof value.value === 'string'
    ? value.value.trim() || null
    : null
}

function readDirectiveValue(
  directives: RComponentSFC_AST_Directive[],
  name: string,
): ComponentSFCVisualSourceValue | null {
  const directive = directives.find(item => item.name === name)
  return directive ? readDirective(directive) : null
}

function readKeyDirective(
  source: string,
  directive: RComponentSFC_AST_Directive,
  value: RComponentSFC_IR_Value,
): ComponentSFCVisualSourceValue {
  const raw = source.slice(directive.range.start, directive.range.end).trim()
  if (raw.startsWith(':') || raw.startsWith('v-bind:'))
    return toVisualValue(value)
  return directive.expression == null
    ? { kind: 'boolean', value: true }
    : { kind: 'literal', value: directive.expression }
}

function readDirective(directive: RComponentSFC_AST_Directive): ComponentSFCVisualSourceValue {
  if (directive.expression == null)
    return { kind: 'boolean', value: true }
  return { kind: 'literal', value: directive.expression }
}

function readProp(
  node: RComponentSFC_IR_ElementNode | null,
  ...names: string[]
): ComponentSFCVisualSourceValue | null {
  if (!node)
    return null

  for (const name of names) {
    if (node.props[name])
      return toVisualValue(node.props[name])
  }

  return null
}

function toVisualValue(value: RComponentSFC_IR_Value): ComponentSFCVisualSourceValue {
  if (value.kind === 'expression')
    return { kind: 'expression', source: value.source }
  if (typeof value.value === 'boolean')
    return { kind: 'boolean', value: value.value }
  return { kind: 'literal', value: value.value }
}

function valueLabel(value: ComponentSFCVisualSourceValue | null): string {
  if (!value)
    return ''
  if (value.kind === 'expression')
    return value.source
  return String(value.value ?? '')
}
