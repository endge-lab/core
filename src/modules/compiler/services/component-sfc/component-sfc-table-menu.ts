import type { RComponentDiagnostic } from '@/modules/domain/types/component/component-core.types'
import type {
  ComponentSFCTableCellMenuDescriptor,
  ComponentSFCTableColumnMenuDescriptor,
  ComponentSFCTableMenuItemDescriptor,
  ComponentSFCTableMenuNodeDescriptor,
  ComponentSFCTableRowMenuDescriptor,
  RComponentSFC_IR_ElementNode,
  RComponentSFC_IR_Value,
} from '@/modules/domain/types/component/sfc/ir.types'
import type { ComponentSFCActionPort } from '@/modules/domain/types/component/sfc/ports.types'
import { parseExpression } from '@babel/parser'
import * as t from '@babel/types'
import { ENDGE_SFC_TABLE_COLUMN_MENU_MODES } from '@/modules/domain/types/component/sfc/tag-attribute-contract.types'

export const SFC_TABLE_COLUMN_MENU_MODES = ENDGE_SFC_TABLE_COLUMN_MENU_MODES

export type {
  ComponentSFCTableCellMenuDescriptor,
  ComponentSFCTableCellMenuMode,
  ComponentSFCTableColumnMenuDescriptor,
  ComponentSFCTableColumnMenuMode,
  ComponentSFCTableMenuDescriptor,
  ComponentSFCTableMenuItemDescriptor,
  ComponentSFCTableMenuNodeDescriptor,
  ComponentSFCTableMenuSeparatorDescriptor,
  ComponentSFCTableRowMenuDescriptor,
  ComponentSFCTableRowMenuMode,
} from '@/modules/domain/types/component/sfc/ir.types'

interface NormalizeMenuOptions {
  availableActions?: ComponentSFCActionPort[]
}

const COLUMN_MENU_MODE_SET = new Set<string>(SFC_TABLE_COLUMN_MENU_MODES)
type TableMenuTag = 'ColumnMenu' | 'CellMenu' | 'RowMenu'
/** Normalizes declarative column context menu without evaluating SFC expressions. */
export function normalizeComponentSFCTableColumnMenu(
  tableNode: RComponentSFC_IR_ElementNode,
  actionsOrOptions?: ComponentSFCActionPort[] | NormalizeMenuOptions,
): ComponentSFCTableColumnMenuDescriptor {
  const diagnostics: RComponentDiagnostic[] = []
  const mode = normalizeColumnMenuMode(
    readLiteralProp(tableNode, 'column-menu') ?? readLiteralProp(tableNode, 'columnMenu'),
    diagnostics,
  )
  const options = normalizeOptions(actionsOrOptions)

  diagnostics.push(...collectUnsupportedMenuPlacements(tableNode))
  if (mode === 'disabled') {
    return { mode, menu: null, diagnostics }
  }

  const menuNodes = directMenuNodes(tableNode, 'ColumnMenu')
  if (menuNodes.length === 0) {
    return { mode: 'default', menu: null, diagnostics }
  }
  reportDuplicateMenu(menuNodes, 'ColumnMenu', diagnostics)

  return {
    mode: 'inline',
    menu: {
      kind: 'sfc-table-menu',
      items: collectMenuItems(tableNode, menuNodes[0], 'ColumnMenu', diagnostics, options),
    },
    diagnostics,
  }
}

/** Normalizes one optional row menu. Cell-aware values remain expressions until a right click occurs. */
export function normalizeComponentSFCTableRowMenu(
  tableNode: RComponentSFC_IR_ElementNode,
  actionsOrOptions?: ComponentSFCActionPort[] | NormalizeMenuOptions,
): ComponentSFCTableRowMenuDescriptor {
  const diagnostics: RComponentDiagnostic[] = []
  const options = normalizeOptions(actionsOrOptions)
  const menuNodes = directMenuNodes(tableNode, 'RowMenu')
  if (menuNodes.length === 0) {
    return { mode: 'none', menu: null, diagnostics }
  }
  reportDuplicateMenu(menuNodes, 'RowMenu', diagnostics)

  return {
    mode: 'inline',
    menu: {
      kind: 'sfc-table-menu',
      items: collectMenuItems(tableNode, menuNodes[0], 'RowMenu', diagnostics, options),
    },
    diagnostics,
  }
}

/** Normalizes the canonical Table > CellMenu, falling back to legacy Table > RowMenu. */
export function normalizeComponentSFCTableCellMenu(
  tableNode: RComponentSFC_IR_ElementNode,
  actionsOrOptions?: ComponentSFCActionPort[] | NormalizeMenuOptions,
): ComponentSFCTableCellMenuDescriptor {
  const diagnostics: RComponentDiagnostic[] = []
  const options = normalizeOptions(actionsOrOptions)
  const cellMenus = directMenuNodes(tableNode, 'CellMenu')
  const rowMenus = directMenuNodes(tableNode, 'RowMenu')

  if (cellMenus.length && rowMenus.length) {
    diagnostics.push(menuDiagnostic(
      rowMenus[0],
      'sfc-table-cell-menu-legacy-conflict',
      'Используйте только CellMenu. RowMenu является deprecated compatibility alias.',
      'CellMenu',
    ))
  }

  const menuTag: 'CellMenu' | 'RowMenu' = cellMenus.length ? 'CellMenu' : 'RowMenu'
  const menuNodes = cellMenus.length ? cellMenus : rowMenus
  if (menuNodes.length === 0) {
    return { mode: 'none', menu: null, diagnostics }
  }
  reportDuplicateMenu(menuNodes, menuTag, diagnostics)

  return {
    mode: 'inline',
    menu: {
      kind: 'sfc-table-menu',
      items: collectMenuItems(tableNode, menuNodes[0], menuTag, diagnostics, options),
    },
    diagnostics,
  }
}

/** Normalizes an optional Column > CellMenu override; `cell-menu="none"` disables the default. */
export function normalizeComponentSFCColumnCellMenu(
  tableNode: RComponentSFC_IR_ElementNode,
  columnNode: RComponentSFC_IR_ElementNode,
  actionsOrOptions?: ComponentSFCActionPort[] | NormalizeMenuOptions,
): ComponentSFCTableCellMenuDescriptor | undefined {
  const diagnostics: RComponentDiagnostic[] = []
  const options = normalizeOptions(actionsOrOptions)
  const mode = readLiteralProp(columnNode, 'cell-menu') ?? readLiteralProp(columnNode, 'cellMenu')
  const menuNodes = directMenuNodes(columnNode, 'CellMenu')

  if (mode === 'none') {
    if (menuNodes.length) {
      diagnostics.push(menuDiagnostic(
        menuNodes[0],
        'sfc-table-column-cell-menu-conflict',
        'Column cell-menu="none" нельзя использовать одновременно с Column > CellMenu.',
        'CellMenu',
      ))
    }
    return { mode: 'none', menu: null, diagnostics }
  }
  if (mode != null && mode !== '') {
    diagnostics.push(menuDiagnostic(
      columnNode,
      'sfc-table-column-cell-menu-mode-invalid',
      `Column cell-menu поддерживает только значение "none", получено "${String(mode)}".`,
      'CellMenu',
    ))
  }
  if (!menuNodes.length && !diagnostics.length) {
    return undefined
  }
  if (!menuNodes.length) {
    return { mode: 'none', menu: null, diagnostics }
  }
  reportDuplicateMenu(menuNodes, 'CellMenu', diagnostics)
  return {
    mode: 'inline',
    menu: {
      kind: 'sfc-table-menu',
      items: collectMenuItems(tableNode, menuNodes[0], 'CellMenu', diagnostics, options),
    },
    diagnostics,
  }
}

function collectMenuItems(
  tableNode: RComponentSFC_IR_ElementNode,
  menuNode: RComponentSFC_IR_ElementNode,
  menuTag: TableMenuTag,
  diagnostics: RComponentDiagnostic[],
  options: NormalizeMenuOptions,
): ComponentSFCTableMenuNodeDescriptor[] {
  const items: ComponentSFCTableMenuNodeDescriptor[] = []
  let index = 0

  for (const child of menuNode.children) {
    if (!isElementNode(child)) {
      continue
    }
    if (child.tag === 'MenuSeparator') {
      items.push({ kind: 'separator', id: readLiteralStringProp(child, 'id') || `separator-${index}` })
      index++
      continue
    }
    if (child.tag === 'MenuItem') {
      const item = createItemDescriptor(tableNode, child, index, menuTag, diagnostics, options)
      if (item) {
        items.push(item)
        index++
      }
      continue
    }
    diagnostics.push(menuDiagnostic(
      child,
      `sfc-table-${menuCode(menuTag)}-child-unsupported`,
      `${menuTag} не поддерживает дочерний tag "${child.tag}".`,
      menuTag,
    ))
  }

  return items
}

function createItemDescriptor(
  tableNode: RComponentSFC_IR_ElementNode,
  node: RComponentSFC_IR_ElementNode,
  index: number,
  menuTag: TableMenuTag,
  diagnostics: RComponentDiagnostic[],
  options: NormalizeMenuOptions,
): ComponentSFCTableMenuItemDescriptor | null {
  const actionBinding = readActionBinding(node, menuTag, diagnostics)
  const actionAlias = actionBinding?.identity ?? ''
  const legacyCommand = readLiteralStringProp(node, 'command')
  const label = node.props.label
  const icon = readLiteralStringProp(node, 'icon') || undefined
  const explicitInput = node.props.input

  if (legacyCommand) {
    diagnostics.push(menuDiagnostic(
      node,
      `sfc-table-${menuCode(menuTag)}-item-command-removed`,
      'Атрибут command удалён. Используйте action="..." и optional :input="...".',
      menuTag,
      'command',
    ))
  }
  if (!actionAlias) {
    diagnostics.push(menuDiagnostic(
      node,
      `sfc-table-${menuCode(menuTag)}-item-action-missing`,
      'MenuItem должен содержать literal Action identity, ссылку на Action port или совместимый static :action object.',
      menuTag,
      'action',
    ))
  }
  if (!label) {
    diagnostics.push(menuDiagnostic(
      node,
      `sfc-table-${menuCode(menuTag)}-item-label-missing`,
      'MenuItem должен содержать label или :label expression.',
      menuTag,
      'label',
    ))
  }
  if (actionBinding?.hasInput && explicitInput) {
    diagnostics.push(menuDiagnostic(
      node,
      `sfc-table-${menuCode(menuTag)}-item-input-conflict`,
      'Input задан одновременно внутри legacy :action object и отдельным :input. Оставьте только один вариант.',
      menuTag,
      'input',
    ))
  }

  const explicitPortReference = actionBinding?.kind === 'port'
  const port = actionAlias && options.availableActions
    ? options.availableActions.find(candidate => candidate.name === actionAlias
      && (!actionBinding?.portRole || candidate.role === actionBinding.portRole))
    : undefined
  if (actionAlias && explicitPortReference && options.availableActions && !port) {
    diagnostics.push(menuDiagnostic(
      node,
      `sfc-table-${menuCode(menuTag)}-item-action-port-missing`,
      `Action port "${actionAlias}" не объявлен в definePorts${actionBinding.portRole ? `.${actionBinding.portRole}` : '.require/provides'}.`,
      menuTag,
      'action',
    ))
  }
  if (port?.forwardedFrom && port.forwardedFrom.nodeId !== tableNode.id) {
    diagnostics.push(menuDiagnostic(
      node,
      `sfc-table-${menuCode(menuTag)}-item-action-target-incompatible`,
      `Forwarded Action "${actionAlias}" принадлежит другому child runtime (${port.forwardedFrom.ref ?? port.forwardedFrom.nodeId}).`,
      menuTag,
      'action',
    ))
  }

  if (!actionAlias || !label || legacyCommand || (actionBinding?.hasInput && explicitInput) || (explicitPortReference && !port)) {
    return null
  }

  const forwardedFrom = port?.forwardedFrom?.nodeId === tableNode.id ? port.forwardedFrom : undefined
  const action = forwardedFrom?.portName ?? port?.defaultIdentity ?? actionAlias
  const requiredPort = port?.role === 'require' ? port.name : undefined
  const input = explicitInput ?? actionBinding?.input
  return {
    kind: 'item',
    id: readLiteralStringProp(node, 'id') || actionAlias || `item-${index}`,
    label,
    ...(node.directives.if ? { visible: node.directives.if } : {}),
    ...(node.props.disabled ? { disabled: node.props.disabled } : {}),
    action,
    ...(requiredPort ? { requiredPort } : {}),
    ...(input ? { input } : {}),
    ...(icon ? { icon } : {}),
    ...(forwardedFrom ? { forwardedFrom } : {}),
  }
}

interface NormalizedMenuActionBinding {
  kind: 'identity' | 'port'
  identity: string
  portRole?: 'require' | 'provides'
  input?: RComponentSFC_IR_Value
  hasInput: boolean
}

const STATIC_VALUE_UNSUPPORTED = Symbol('static-value-unsupported')

function readActionBinding(
  node: RComponentSFC_IR_ElementNode,
  menuTag: TableMenuTag,
  diagnostics: RComponentDiagnostic[],
): NormalizedMenuActionBinding | null {
  const value = node.props.action
  if (value?.kind === 'literal') {
    const identity = typeof value.value === 'string' ? value.value.trim() : ''
    return identity ? { kind: 'identity', identity, hasInput: false } : null
  }
  if (value?.kind !== 'expression') {
    return null
  }

  try {
    const expression = unwrapExpression(parseExpression(value.source, { sourceType: 'module', plugins: ['typescript'] }))
    const portReference = readActionPortReference(expression)
    if (portReference) {
      return {
        kind: 'port',
        identity: portReference.name,
        ...(portReference.role ? { portRole: portReference.role } : {}),
        hasInput: false,
      }
    }
    if (!t.isObjectExpression(expression)) {
      pushActionBindingDiagnostic(diagnostics, node, menuTag, 'action-reference-required', 'Dynamic :action должен ссылаться на port key (`:action="openDetails"`) или быть static object literal `{ identity, input? }`. Прямую Action identity задавайте строкой `action="..."`.')
      return null
    }
    const properties = new Map<string, t.Expression>()
    for (const property of expression.properties) {
      if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
        pushActionBindingDiagnostic(diagnostics, node, menuTag, 'action-object-invalid', 'Action binding не поддерживает spread, methods и computed properties.')
        return null
      }
      const key = t.isIdentifier(property.key) ? property.key.name : t.isStringLiteral(property.key) ? property.key.value : ''
      if (key) {
        properties.set(key, property.value)
      }
    }
    if (properties.has('payload')) {
      pushActionBindingDiagnostic(diagnostics, node, menuTag, 'action-payload-removed', 'Используйте input вместо payload.')
      return null
    }
    const unsupported = [...properties.keys()].filter(key => key !== 'identity' && key !== 'input')
    if (unsupported.length) {
      pushActionBindingDiagnostic(diagnostics, node, menuTag, 'action-input-required', `Пользовательские поля Action должны находиться внутри input: ${unsupported.join(', ')}.`)
      return null
    }
    const identityValue = properties.get('identity')
    const identityNode = identityValue ? unwrapExpression(identityValue) : null
    const identity = identityNode && t.isStringLiteral(identityNode) ? identityNode.value.trim() : ''
    if (!identity) {
      pushActionBindingDiagnostic(diagnostics, node, menuTag, 'action-identity-missing', 'Action binding должен содержать literal identity.')
      return null
    }
    const inputExpression = properties.get('input')
    if (!inputExpression) {
      return { kind: 'identity', identity, hasInput: false }
    }
    const input = readStaticExpression(inputExpression)
    if (input === STATIC_VALUE_UNSUPPORTED) {
      pushActionBindingDiagnostic(diagnostics, node, menuTag, 'action-input-dynamic', 'Dynamic input в legacy :action object не поддерживается. Используйте отдельный :input expression.')
      return null
    }
    return { kind: 'identity', identity, input: { kind: 'literal', value: input }, hasInput: true }
  }
  catch {
    pushActionBindingDiagnostic(diagnostics, node, menuTag, 'action-binding-invalid', 'Не удалось разобрать MenuItem :action.')
    return null
  }
}

/** Reads a compile-time MenuItem reference to one Action port. */
export function readComponentSFCTableMenuActionPortReference(
  source: string,
): { name: string, role?: 'require' | 'provides' } | null {
  try {
    const expression = unwrapExpression(parseExpression(source, { sourceType: 'module', plugins: ['typescript'] }))
    return readActionPortReference(expression)
  }
  catch {
    return null
  }
}

function readActionPortReference(
  expression: t.Expression,
): { name: string, role?: 'require' | 'provides' } | null {
  if (t.isIdentifier(expression)) {
    return { name: expression.name }
  }

  if (!t.isMemberExpression(expression)) {
    return null
  }

  const owner = unwrapExpression(expression.object as t.Expression)
  if (!t.isMemberExpression(owner)) {
    return null
  }

  const root = unwrapExpression(owner.object as t.Expression)
  if (!t.isIdentifier(root, { name: 'ports' })) {
    return null
  }

  const role = readStaticMemberName(owner)
  if (role !== 'require' && role !== 'provides') {
    return null
  }

  const name = readStaticMemberName(expression)?.trim() ?? ''
  return name ? { name, role } : null
}

function readStaticMemberName(expression: t.MemberExpression): string | null {
  if (!expression.computed && t.isIdentifier(expression.property)) {
    return expression.property.name
  }
  if (expression.computed && t.isStringLiteral(expression.property)) {
    return expression.property.value
  }
  return null
}

function readStaticExpression(node: t.Expression): unknown | typeof STATIC_VALUE_UNSUPPORTED {
  const expression = unwrapExpression(node)
  if (t.isStringLiteral(expression) || t.isNumericLiteral(expression) || t.isBooleanLiteral(expression)) {
    return expression.value
  }
  if (t.isNullLiteral(expression)) {
    return null
  }
  if (t.isUnaryExpression(expression) && expression.operator === '-' && t.isNumericLiteral(expression.argument)) {
    return -expression.argument.value
  }
  if (t.isArrayExpression(expression)) {
    const result: unknown[] = []
    for (const element of expression.elements) {
      if (!element || !t.isExpression(element)) {
        return STATIC_VALUE_UNSUPPORTED
      }
      const item = readStaticExpression(element)
      if (item === STATIC_VALUE_UNSUPPORTED) {
        return item
      }
      result.push(item)
    }
    return result
  }
  if (t.isObjectExpression(expression)) {
    const result: Record<string, unknown> = {}
    for (const property of expression.properties) {
      if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
        return STATIC_VALUE_UNSUPPORTED
      }
      const key = t.isIdentifier(property.key) ? property.key.name : t.isStringLiteral(property.key) ? property.key.value : ''
      if (!key) {
        return STATIC_VALUE_UNSUPPORTED
      }
      const item = readStaticExpression(property.value)
      if (item === STATIC_VALUE_UNSUPPORTED) {
        return item
      }
      result[key] = item
    }
    return result
  }
  return STATIC_VALUE_UNSUPPORTED
}

function collectUnsupportedMenuPlacements(tableNode: RComponentSFC_IR_ElementNode): RComponentDiagnostic[] {
  const diagnostics: RComponentDiagnostic[] = []
  for (const child of tableNode.children) {
    if (!isElementNode(child)) {
      continue
    }
    if (child.tag === 'MenuItem' || child.tag === 'MenuSeparator') {
      diagnostics.push(menuDiagnostic(
        child,
        'sfc-table-menu-placement-invalid',
        `${child.tag} должен находиться внутри Table > ColumnMenu или Table/Column > CellMenu.`,
        'ColumnMenu',
      ))
    }
    if (child.tag !== 'Column') {
      continue
    }
    for (const columnChild of child.children) {
      if (!isElementNode(columnChild)) {
        continue
      }
      if (columnChild.tag === 'ColumnMenu' || columnChild.tag === 'RowMenu') {
        diagnostics.push(menuDiagnostic(
          columnChild,
          columnChild.tag === 'ColumnMenu'
            ? 'sfc-table-column-menu-placement-unsupported'
            : 'sfc-table-row-menu-placement-unsupported',
          `Column > ${columnChild.tag} не поддерживается. Для меню ячейки используйте Column > CellMenu.`,
          columnChild.tag,
        ))
      }
      if (columnChild.tag === 'MenuItem' || columnChild.tag === 'MenuSeparator') {
        diagnostics.push(menuDiagnostic(
          columnChild,
          'sfc-table-menu-placement-invalid',
          `${columnChild.tag} должен находиться внутри Table menu.`,
          'ColumnMenu',
        ))
      }
    }
  }
  return diagnostics
}

function normalizeColumnMenuMode(value: unknown, diagnostics: RComponentDiagnostic[]): 'default' | 'disabled' {
  if (value == null || value === '') {
    return 'default'
  }
  const mode = String(value).trim()
  if (COLUMN_MENU_MODE_SET.has(mode)) {
    return mode as 'default' | 'disabled'
  }
  diagnostics.push({
    severity: 'error',
    code: 'sfc-table-column-menu-mode-invalid',
    message: `Table column-menu "${mode}" не поддерживается. Используйте default или disabled.`,
    sourcePath: 'template.Table.column-menu',
  })
  return 'default'
}

function reportDuplicateMenu(nodes: RComponentSFC_IR_ElementNode[], tag: TableMenuTag, diagnostics: RComponentDiagnostic[]): void {
  if (nodes.length < 2) {
    return
  }
  diagnostics.push(menuDiagnostic(
    nodes[1],
    `sfc-table-${menuCode(tag)}-duplicate`,
    `Table поддерживает только один прямой ${tag}.`,
    tag,
  ))
}

function pushActionBindingDiagnostic(
  diagnostics: RComponentDiagnostic[],
  node: RComponentSFC_IR_ElementNode,
  menuTag: TableMenuTag,
  suffix: string,
  message: string,
): void {
  diagnostics.push(menuDiagnostic(node, `sfc-table-${menuCode(menuTag)}-item-${suffix}`, message, menuTag, 'action'))
}

function menuDiagnostic(
  node: RComponentSFC_IR_ElementNode,
  code: string,
  message: string,
  menuTag: TableMenuTag,
  prop?: string,
): RComponentDiagnostic {
  return {
    severity: 'error',
    code,
    message,
    sourcePath: `template.Table.${menuTag}.MenuItem${prop ? `.${prop}` : ''}`,
    start: node.sourceRange?.start,
    end: node.sourceRange?.end,
  }
}

function normalizeOptions(input?: ComponentSFCActionPort[] | NormalizeMenuOptions): NormalizeMenuOptions {
  return Array.isArray(input) ? { availableActions: input } : input ?? {}
}

function directMenuNodes(tableNode: RComponentSFC_IR_ElementNode, tag: TableMenuTag): RComponentSFC_IR_ElementNode[] {
  return tableNode.children.filter(isElementNode).filter(node => node.tag === tag)
}

function menuCode(tag: TableMenuTag): 'column-menu' | 'cell-menu' | 'row-menu' {
  return tag === 'ColumnMenu' ? 'column-menu' : tag === 'CellMenu' ? 'cell-menu' : 'row-menu'
}

function unwrapExpression(node: t.Expression): t.Expression {
  let current = node
  while (t.isTSAsExpression(current) || t.isTSTypeAssertion(current) || t.isTSNonNullExpression(current)) {
    current = current.expression
  }
  return current
}

function readLiteralStringProp(node: RComponentSFC_IR_ElementNode, name: string): string {
  const value = readLiteralProp(node, name)
  return typeof value === 'string' ? value.trim() : ''
}

function readLiteralProp(node: RComponentSFC_IR_ElementNode, name: string): unknown {
  const value = node.props[name]
  return value?.kind === 'literal' ? value.value : undefined
}

function isElementNode(node: unknown): node is RComponentSFC_IR_ElementNode {
  return Boolean(node && typeof node === 'object' && (node as RComponentSFC_IR_ElementNode).kind === 'element')
}
