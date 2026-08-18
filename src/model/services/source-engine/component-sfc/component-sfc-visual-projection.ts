import { parseExpression } from '@babel/parser'

import type {
  ComponentSFCTableCellInteractionFlag,
  ComponentSFCTableCellInteractionModifier,
  ComponentSFCTableCellInteractionRuleProjection,
  ComponentSFCTableCellInteractionsProjection,
  ComponentSFCVisualAttribute,
  ComponentSFCVisualInspection,
  ComponentSFCVisualInspectionOptions,
  ComponentSFCVisualSourceValue,
  ComponentSFCTableColumnProjection,
  ComponentSFCTableMenuActionOption,
  ComponentSFCTableMenuProjection,
  ComponentSFCTableMenuNodeProjection,
  ComponentSFCTableVisualCellTag,
  ComponentSFCTableVisualProjection,
} from '@/domain/types/component/sfc/visual-projection.types'
import type {
  RComponentSFC_AST_Directive,
  RComponentSFC_AST_ElementNode,
  RComponentSFC_AST_TemplateNode,
} from '@/domain/types/component/sfc/ast.types'
import type {
  RComponentSFC_IR_ElementNode,
  RComponentSFC_IR_Value,
} from '@/domain/types/component/sfc/ir.types'
import type { ComponentSFCPortManifest } from '@/domain/types/component/sfc/ports.types'
import { BUILTIN_ACTION_IDS, TABLE_RUNTIME_ACTION_IDS } from '@/domain/types/runtime/action.types'
import { compileComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-compile'
import { readComponentSFCTableMenuActionPortReference } from '@/model/services/compiler/component-sfc/component-sfc-table-menu'
import { isComponentSFCBuiltInTag } from '@/model/services/compiler/component-sfc/component-sfc-template'

const NON_VISUAL_CELL_TAGS = new Set([
  'Component',
  'Table',
  'Column',
  'Cell',
  'ColumnMenu',
  'RowMenu',
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
    resolveTypeDefinition: options.resolveTypeDefinition,
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
    projection: projectTable(source, root, irRoot, compileResult.ir?.script.ports ?? null, options.actionIdentities),
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
  ports: ComponentSFCPortManifest | null,
  actionIdentities: Iterable<string> | undefined,
): ComponentSFCTableVisualProjection {
  const astColumns = ast.children.filter(
    (node): node is RComponentSFC_AST_ElementNode => node.kind === 'element' && node.tag === 'Column',
  )
  const irColumns = ir?.children.filter(
    (node): node is RComponentSFC_IR_ElementNode => node.kind === 'element' && node.tag === 'Column',
  ) ?? []
  const columnMenu = projectMenu(source, ast, ir, ports, 'column')
  const rowMenu = projectMenu(source, ast, ir, ports, 'row')

  return {
    kind: 'table',
    ref: readProp(ir, 'ref'),
    selectionMode: readProp(ir, 'selection-mode', 'selectionMode'),
    selectionTrigger: readProp(ir, 'selection-trigger', 'selectionTrigger'),
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
    menus: { column: columnMenu, row: rowMenu },
    menuActions: projectMenuActions(ir, ports, actionIdentities),
    attributes: projectAttributes(source, ast, ir),
    columns: astColumns.map((column, index) => projectColumn(source, column, irColumns[index] ?? null, index)),
    sourceRange: ast.range,
  }
}

function projectMenu(
  source: string,
  table: RComponentSFC_AST_ElementNode,
  irTable: RComponentSFC_IR_ElementNode | null,
  ports: ComponentSFCPortManifest | null,
  kind: 'column' | 'row',
): ComponentSFCTableMenuProjection {
  const tag = kind === 'column' ? 'ColumnMenu' : 'RowMenu'
  const menu = table.children.find(
    (node): node is RComponentSFC_AST_ElementNode => node.kind === 'element' && node.tag === tag,
  ) ?? null
  const tableMode = kind === 'column' ? readProp(irTable, 'column-menu', 'columnMenu') : null
  const mode = kind === 'column'
    ? tableMode?.kind === 'expression'
      ? 'source'
      : sourceValueText(tableMode) === 'disabled'
        ? 'disabled'
        : menu ? 'custom' : 'default'
    : menu ? 'custom' : 'none'

  if (!menu) return { kind, mode, sourceOwned: mode === 'source', items: [] }
  const sourceOwned = source.slice(menu.range.start, menu.range.end).includes('<!--')
    || menu.children.some(node => node.kind === 'element' && node.tag !== 'MenuItem' && node.tag !== 'MenuSeparator')
  return {
    kind,
    mode,
    sourceOwned,
    sourceRange: menu.range,
    items: menu.children.flatMap<ComponentSFCTableMenuNodeProjection>((node, index) => {
      if (node.kind !== 'element') return []
      if (node.tag === 'MenuSeparator') return [{
        kind: 'separator',
        id: staticAttribute(node, 'id') || `separator-${index}`,
        sourceRange: node.range,
      }]
      if (node.tag !== 'MenuItem') return []
      const action = visualAttribute(node, 'action')
      const itemSourceOwned = sourceOwned
        || (action?.kind === 'expression' && !isActionPortReference(action.source, ports))
        || node.attributes.some(attribute => !['id', 'label', 'action', 'input', 'icon'].includes(attribute.name))
        || node.directives.length > 0
      return [{
        kind: 'item',
        id: staticAttribute(node, 'id') || staticAttribute(node, 'action') || `item-${index}`,
        label: visualAttribute(node, 'label'),
        action,
        input: visualAttribute(node, 'input'),
        icon: visualAttribute(node, 'icon'),
        sourceOwned: itemSourceOwned,
        sourceRange: node.range,
      }]
    }),
  }
}

function isActionPortReference(
  source: string,
  ports: ComponentSFCPortManifest | null,
): boolean {
  const reference = readComponentSFCTableMenuActionPortReference(source)
  if (!reference)
    return false

  const candidates = reference.role === 'require'
    ? ports?.require.actions
    : reference.role === 'provides'
      ? ports?.provides.actions
      : [...(ports?.require.actions ?? []), ...(ports?.provides.actions ?? [])]
  return Boolean(candidates?.some(port => port.name === reference.name))
}

function projectMenuActions(
  table: RComponentSFC_IR_ElementNode | null,
  ports: ComponentSFCPortManifest | null,
  actionIdentities: Iterable<string> | undefined,
): ComponentSFCTableMenuActionOption[] {
  const result = new Map<string, ComponentSFCTableMenuActionOption>()
  for (const rawIdentity of actionIdentities ?? []) {
    const identity = String(rawIdentity ?? '').trim()
    if (identity) result.set(identity, { identity, source: 'external' })
  }
  for (const identity of Object.values(TABLE_RUNTIME_ACTION_IDS))
    result.set(identity, { identity, source: 'intrinsic' })
  for (const identity of Object.values(BUILTIN_ACTION_IDS))
    result.set(identity, { identity, source: 'built-in' })
  for (const port of ports?.require.actions ?? [])
    result.set(port.name, { identity: port.name, source: 'required' })
  for (const port of ports?.provides.actions ?? []) {
    if (port.forwardedFrom && port.forwardedFrom.nodeId !== table?.id) continue
    result.set(port.name, {
      identity: port.name,
      source: port.forwardedFrom ? 'forwarded' : 'provided',
    })
  }
  return [...result.values()].sort((left, right) => left.identity.localeCompare(right.identity))
}

function visualAttribute(node: RComponentSFC_AST_ElementNode, name: string): ComponentSFCVisualSourceValue | null {
  const attribute = node.attributes.find(item => item.name === name)
  if (!attribute) return null
  if (attribute.dynamic) return { kind: 'expression', source: attribute.value ?? '' }
  if (attribute.value == null) return { kind: 'boolean', value: true }
  return { kind: 'literal', value: attribute.value }
}

function staticAttribute(node: RComponentSFC_AST_ElementNode, name: string): string {
  const value = visualAttribute(node, name)
  return value?.kind === 'literal' ? String(value.value ?? '').trim() : ''
}

function sourceValueText(value: ComponentSFCVisualSourceValue | null): string {
  if (!value) return ''
  return value.kind === 'expression' ? value.source : String(value.value ?? '')
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
    interactions: projectColumnCellInteractions(cellNode),
    hasCustomCell: cell.hasCustomCell,
    cellSource: cell.source,
    sourceRange: ast.range,
  }
}

const CELL_INTERACTION_FLAGS = new Set<ComponentSFCTableCellInteractionFlag>([
  'stop', 'prevent', 'self', 'once', 'capture', 'passive',
])
const CELL_INTERACTION_MODIFIERS = new Set<ComponentSFCTableCellInteractionModifier>([
  'ctrl', 'shift', 'alt', 'meta', 'mod', 'altGraph', 'exact',
])

function projectColumnCellInteractions(
  cell: RComponentSFC_AST_ElementNode | null,
): ComponentSFCTableCellInteractionsProjection {
  const attribute = cell?.attributes.find(item => item.name === 'on') ?? null
  if (!attribute) return { editable: true, rules: [], suffixes: [] }

  const suffixes = attribute.modifiers.filter(
    (modifier): modifier is ComponentSFCTableCellInteractionFlag => CELL_INTERACTION_FLAGS.has(modifier as ComponentSFCTableCellInteractionFlag),
  )
  if (!attribute.dynamic || !attribute.value?.trim()) {
    return sourceOwnedInteractions(attribute.range, suffixes, ':on должен быть динамическим object или array binding.')
  }

  try {
    const source = attribute.value.trim()
    const expression: any = parseExpression(source, { sourceType: 'module', plugins: ['typescript'] })
    const nodes = expression.type === 'ArrayExpression' ? expression.elements : [expression]
    const rules: Array<ComponentSFCTableCellInteractionRuleProjection | null> = (nodes as any[])
      .map((node: any) => projectCellInteractionRule(node, source))
    if (!rules.length || rules.some(rule => !rule))
      return sourceOwnedInteractions(attribute.range, suffixes, 'Сложная :on-аннотация редактируется во вкладке Source.')
    return {
      editable: true,
      rules: rules as ComponentSFCTableCellInteractionRuleProjection[],
      suffixes,
      sourceRange: attribute.range,
    }
  }
  catch {
    return sourceOwnedInteractions(attribute.range, suffixes, 'Не удалось разобрать :on. Исправьте выражение во вкладке Source.')
  }
}

function sourceOwnedInteractions(
  sourceRange: RComponentSFC_AST_ElementNode['range'],
  suffixes: ComponentSFCTableCellInteractionFlag[],
  message: string,
): ComponentSFCTableCellInteractionsProjection {
  return { editable: false, rules: [], suffixes, sourceRange, message }
}

function projectCellInteractionRule(
  node: any,
  source: string,
): ComponentSFCTableCellInteractionRuleProjection | null {
  if (node?.type !== 'ObjectExpression') return null
  const properties = new Map<string, any>()
  for (const property of node.properties ?? []) {
    if (property?.type !== 'ObjectProperty' || property.computed) return null
    const name = babelPropertyName(property)
    if (!name || properties.has(name)) return null
    properties.set(name, property.value)
  }

  const event = babelLiteralString(properties.get('event'))
  const reaction = properties.get('reaction')
  if (!event || !reaction) return null
  const key = babelStringList(properties.get('key'))
  const code = babelStringList(properties.get('code'))
  if (key === null || code === null) return null
  const held = projectHeldKeys(properties.get('held'))
  const modifiers = projectInteractionModifiers(properties.get('modifiers'))
  if (held === undefined || modifiers === null) return null

  const flags: ComponentSFCTableCellInteractionRuleProjection['flags'] = {}
  for (const flag of CELL_INTERACTION_FLAGS) {
    const value = babelOptionalBoolean(properties.get(flag))
    if (value === undefined && properties.has(flag)) return null
    if (value != null) flags[flag] = value
  }
  const repeat = babelNullableBoolean(properties.get('repeat'))
  const composing = babelNullableBoolean(properties.get('composing'))
  const button = babelNullableNumber(properties.get('button'))
  if (repeat === undefined || composing === undefined || button === undefined) return null

  const supported = new Set([
    'event', 'key', 'code', 'held', 'modifiers', 'repeat', 'composing', 'button',
    ...CELL_INTERACTION_FLAGS, 'reaction',
  ])
  if ([...properties.keys()].some(name => !supported.has(name))) return null

  return {
    event,
    key: key ?? [],
    code: code ?? [],
    held: held ?? null,
    modifiers,
    repeat,
    composing,
    button,
    flags,
    reactionSource: source.slice(reaction.start ?? 0, reaction.end ?? source.length),
  }
}

function projectHeldKeys(node: any): ComponentSFCTableCellInteractionRuleProjection['held'] | null | undefined {
  if (node == null) return null
  if (node.type !== 'ObjectExpression') return undefined
  const values = babelObjectProperties(node)
  if (!values) return undefined
  const key = babelStringList(values.get('key'))
  const code = babelStringList(values.get('code'))
  const match = values.has('match') ? babelLiteralString(values.get('match')) : 'all'
  const exact = values.has('exact') ? babelOptionalBoolean(values.get('exact')) : false
  if (key === null || code === null || (match !== 'all' && match !== 'any') || exact == null) return undefined
  if ([...values.keys()].some(name => !['key', 'code', 'match', 'exact'].includes(name))) return undefined
  return { key: key ?? [], code: code ?? [], match, exact }
}

function projectInteractionModifiers(
  node: any,
): ComponentSFCTableCellInteractionRuleProjection['modifiers'] | null {
  if (node == null) return {}
  if (node.type !== 'ObjectExpression') return null
  const values = babelObjectProperties(node)
  if (!values) return null
  const result: ComponentSFCTableCellInteractionRuleProjection['modifiers'] = {}
  for (const [name, valueNode] of values) {
    if (!CELL_INTERACTION_MODIFIERS.has(name as ComponentSFCTableCellInteractionModifier)) return null
    const value = babelOptionalBoolean(valueNode)
    if (value == null) return null
    result[name as ComponentSFCTableCellInteractionModifier] = value
  }
  return result
}

function babelObjectProperties(node: any): Map<string, any> | null {
  const result = new Map<string, any>()
  for (const property of node.properties ?? []) {
    if (property?.type !== 'ObjectProperty' || property.computed) return null
    const name = babelPropertyName(property)
    if (!name || result.has(name)) return null
    result.set(name, property.value)
  }
  return result
}

function babelPropertyName(property: any): string | null {
  if (property?.key?.type === 'Identifier') return property.key.name
  if (property?.key?.type === 'StringLiteral') return String(property.key.value)
  return null
}

function babelLiteralString(node: any): string | null {
  if (node?.type === 'StringLiteral') return String(node.value)
  if (node?.type === 'TemplateLiteral' && node.expressions?.length === 0)
    return String(node.quasis?.[0]?.value?.cooked ?? '')
  return null
}

function babelStringList(node: any): string[] | null | undefined {
  if (node == null) return undefined
  const single = babelLiteralString(node)
  if (single != null) return [single]
  if (node.type !== 'ArrayExpression') return null
  const result = node.elements.map((item: any) => babelLiteralString(item))
  return result.some((item: string | null) => item == null) ? null : result as string[]
}

function babelOptionalBoolean(node: any): boolean | null | undefined {
  if (node == null) return null
  return node.type === 'BooleanLiteral' ? node.value === true : undefined
}

function babelNullableBoolean(node: any): boolean | null | undefined {
  if (node == null) return null
  return babelOptionalBoolean(node)
}

function babelNullableNumber(node: any): number | null | undefined {
  if (node == null) return null
  return node.type === 'NumericLiteral' && Number.isFinite(node.value) ? Number(node.value) : undefined
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
