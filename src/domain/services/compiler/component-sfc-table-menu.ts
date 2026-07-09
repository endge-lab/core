import type { RComponentDiagnostic } from '@/domain/types/component-core.types'
import type {
  RComponentSFC_IR_ElementNode,
  RComponentSFC_IR_Value,
} from '@/domain/types/component-sfc.types'
import type {
  ContextMenuDescriptor,
  ContextMenuItemDescriptor,
  ContextMenuNodeDescriptor,
  ContextMenuSeparatorDescriptor,
} from '@/domain/types/context-menu.types'

export const SFC_TABLE_COLUMN_MENU_MODES = ['default', 'disabled'] as const

export type ComponentSFCTableColumnMenuMode = typeof SFC_TABLE_COLUMN_MENU_MODES[number] | 'inline'

export interface ComponentSFCTableColumnMenuDescriptor {
  mode: ComponentSFCTableColumnMenuMode
  menu: ContextMenuDescriptor | null
  diagnostics: RComponentDiagnostic[]
}

const COLUMN_MENU_MODE_SET = new Set<string>(SFC_TABLE_COLUMN_MENU_MODES)

/** Нормализует declarative column context menu для SFC Table без renderer-specific деталей. */
export function normalizeComponentSFCTableColumnMenu(
  tableNode: RComponentSFC_IR_ElementNode,
): ComponentSFCTableColumnMenuDescriptor {
  const diagnostics: RComponentDiagnostic[] = []
  const mode = normalizeColumnMenuMode(
    readLiteralProp(tableNode, 'column-menu') ?? readLiteralProp(tableNode, 'columnMenu'),
    diagnostics,
  )

  diagnostics.push(...collectUnsupportedColumnMenuPlacements(tableNode))

  if (mode === 'disabled') {
    return {
      mode,
      menu: null,
      diagnostics,
    }
  }

  const menuNodes = tableNode.children
    .filter(isElementNode)
    .filter(node => node.tag === 'ColumnMenu')

  if (menuNodes.length === 0) {
    return {
      mode: 'default',
      menu: null,
      diagnostics,
    }
  }

  if (menuNodes.length > 1) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-table-column-menu-duplicate',
      message: 'Table поддерживает только один прямой ColumnMenu в v1.',
      sourcePath: 'template.Table.ColumnMenu',
      start: menuNodes[1].sourceRange?.start,
      end: menuNodes[1].sourceRange?.end,
    })
  }

  return {
    mode: 'inline',
    menu: {
      kind: 'context-menu',
      items: collectMenuItems(menuNodes[0], diagnostics),
    },
    diagnostics,
  }
}

function collectMenuItems(
  menuNode: RComponentSFC_IR_ElementNode,
  diagnostics: RComponentDiagnostic[],
): ContextMenuNodeDescriptor[] {
  const items: ContextMenuNodeDescriptor[] = []
  let index = 0

  for (const child of menuNode.children) {
    if (!isElementNode(child))
      continue

    if (child.tag === 'MenuSeparator') {
      items.push(createSeparatorDescriptor(child, index))
      index++
      continue
    }

    if (child.tag === 'MenuItem') {
      const item = createItemDescriptor(child, index, diagnostics)
      if (item) {
        items.push(item)
        index++
      }
      continue
    }

    diagnostics.push({
      severity: 'error',
      code: 'sfc-table-column-menu-child-unsupported',
      message: `ColumnMenu не поддерживает дочерний tag "${child.tag}" в v1.`,
      sourcePath: `template.Table.ColumnMenu.${child.tag}`,
      start: child.sourceRange?.start,
      end: child.sourceRange?.end,
    })
  }

  return items
}

function createItemDescriptor(
  node: RComponentSFC_IR_ElementNode,
  index: number,
  diagnostics: RComponentDiagnostic[],
): ContextMenuItemDescriptor | null {
  const command = readLiteralStringProp(node, 'command')
  const label = readLiteralStringProp(node, 'label')
  const id = readLiteralStringProp(node, 'id') || command || `item-${index}`
  const icon = readLiteralStringProp(node, 'icon') || undefined

  if (!command) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-table-column-menu-item-command-missing',
      message: 'MenuItem должен содержать literal command.',
      sourcePath: 'template.Table.ColumnMenu.MenuItem.command',
      start: node.sourceRange?.start,
      end: node.sourceRange?.end,
    })
  }

  if (!label) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-table-column-menu-item-label-missing',
      message: 'MenuItem должен содержать literal label.',
      sourcePath: 'template.Table.ColumnMenu.MenuItem.label',
      start: node.sourceRange?.start,
      end: node.sourceRange?.end,
    })
  }

  if (!command || !label)
    return null

  return {
    kind: 'item',
    id,
    label,
    command,
    ...(icon ? { icon } : {}),
  }
}

function createSeparatorDescriptor(
  node: RComponentSFC_IR_ElementNode,
  index: number,
): ContextMenuSeparatorDescriptor {
  return {
    kind: 'separator',
    id: readLiteralStringProp(node, 'id') || `separator-${index}`,
  }
}

function collectUnsupportedColumnMenuPlacements(tableNode: RComponentSFC_IR_ElementNode): RComponentDiagnostic[] {
  const diagnostics: RComponentDiagnostic[] = []

  for (const child of tableNode.children) {
    if (!isElementNode(child))
      continue

    if (child.tag === 'MenuItem' || child.tag === 'MenuSeparator') {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-table-column-menu-placement-invalid',
        message: `${child.tag} должен находиться внутри Table > ColumnMenu.`,
        sourcePath: `template.Table.${child.tag}`,
        start: child.sourceRange?.start,
        end: child.sourceRange?.end,
      })
    }

    if (child.tag !== 'Column')
      continue

    for (const columnChild of child.children) {
      if (!isElementNode(columnChild))
        continue

      if (columnChild.tag === 'ColumnMenu') {
        diagnostics.push({
          severity: 'error',
          code: 'sfc-table-column-menu-placement-unsupported',
          message: 'Column > ColumnMenu пока не поддерживается в v1. Используйте Table > ColumnMenu.',
          sourcePath: 'template.Table.Column.ColumnMenu',
          start: columnChild.sourceRange?.start,
          end: columnChild.sourceRange?.end,
        })
      }

      if (columnChild.tag === 'MenuItem' || columnChild.tag === 'MenuSeparator') {
        diagnostics.push({
          severity: 'error',
          code: 'sfc-table-column-menu-placement-invalid',
          message: `${columnChild.tag} должен находиться внутри Table > ColumnMenu.`,
          sourcePath: `template.Table.Column.${columnChild.tag}`,
          start: columnChild.sourceRange?.start,
          end: columnChild.sourceRange?.end,
        })
      }
    }
  }

  return diagnostics
}

function normalizeColumnMenuMode(
  value: unknown,
  diagnostics: RComponentDiagnostic[],
): 'default' | 'disabled' {
  if (value == null || value === '')
    return 'default'

  const mode = String(value).trim()
  if (COLUMN_MENU_MODE_SET.has(mode))
    return mode as 'default' | 'disabled'

  diagnostics.push({
    severity: 'error',
    code: 'sfc-table-column-menu-mode-invalid',
    message: `Table column-menu "${mode}" не поддерживается. Используйте default или disabled.`,
    sourcePath: 'template.Table.column-menu',
  })
  return 'default'
}

function readLiteralStringProp(node: RComponentSFC_IR_ElementNode, name: string): string {
  const value = readLiteralProp(node, name)
  return typeof value === 'string' ? value.trim() : ''
}

function readLiteralProp(node: RComponentSFC_IR_ElementNode, name: string): unknown {
  return readLiteralValue(node.props[name])
}

function readLiteralValue(value: RComponentSFC_IR_Value | undefined): unknown {
  return value?.kind === 'literal' ? value.value : undefined
}

function isElementNode(node: unknown): node is RComponentSFC_IR_ElementNode {
  return Boolean(node && typeof node === 'object' && (node as RComponentSFC_IR_ElementNode).kind === 'element')
}
