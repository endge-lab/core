import type {
  RComponentSFC_AST_Directive,
  RComponentSFC_AST_ElementNode,
  RComponentSFC_AST_TemplateNode,
} from '@/features/core/modules/domain/types/component/sfc/ast.types'

import type {
  ComponentSFCInteractionTrigger,
  RComponentSFC_IR_ElementNode,
  RComponentSFC_IR_Value,
} from '@/features/core/modules/domain/types/component/sfc/ir.types'
import type { ComponentSFCPortManifest } from '@/features/core/modules/domain/types/component/sfc/ports.types'
import type {
  ComponentSFCEditOutcomeProjection,
  ComponentSFCEventReactionProjection,
  ComponentSFCInteractionTriggerProjection,
  ComponentSFCTableCellEditingProjection,
  ComponentSFCTableCellInteractionFlag,
  ComponentSFCTableCellInteractionModifier,
  ComponentSFCTableCellInteractionRuleProjection,
  ComponentSFCTableCellInteractionsProjection,
  ComponentSFCTableColumnProjection,
  ComponentSFCTableEditableElementProjection,
  ComponentSFCTableMenuActionOption,
  ComponentSFCTableMenuNodeProjection,
  ComponentSFCTableMenuProjection,
  ComponentSFCTableVisualCellSyntax,
  ComponentSFCTableVisualCellTag,
  ComponentSFCTableVisualProjection,
  ComponentSFCVisualAttribute,
  ComponentSFCVisualInspection,
  ComponentSFCVisualInspectionOptions,
  ComponentSFCVisualSourceValue,
} from '@/features/core/modules/domain/types/component/sfc/visual-projection.types'
import { parseExpression } from '@babel/parser'
import { compileComponentSFC } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-compile'
import { readComponentSFCTableMenuActionPortReference } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-table-menu'
import { isComponentSFCBuiltInTag } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-template'
import { normalizeComponentSFCInteractionTriggers } from '@/features/core/modules/domain/component/component-sfc-edit-trigger'
import { BUILTIN_ACTION_IDS, TABLE_RUNTIME_ACTION_IDS } from '@/features/core/modules/runtime/domain/action.types'

const NON_VISUAL_CELL_TAGS = new Set([
  'Component',
  'Table',
  'Column',
  'Cell',
  'ColumnMenu',
  'CellMenu',
  'RowMenu',
  'MenuItem',
  'MenuSeparator',
  'Editable',
  'Variant',
])

const EDITABLE_PRIMITIVE_TAGS = new Set(['Text', 'Number', 'DateTime'])

/** Строит UI-neutral visual projection только для SFC с одним корневым Table. */
export function inspectComponentSFCVisual(
  source: string,
  options: ComponentSFCVisualInspectionOptions = {},
): ComponentSFCVisualInspection {
  const compileResult = compileComponentSFC(source, {
    resolveComponentTag: options.resolveComponentTag,
    resolveTypeDefinition: options.resolveTypeDefinition,
    sfcEditing: options.sfcEditing,
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
    cellSelectionMode: readProp(ir, 'cell-selection-mode', 'cellSelectionMode'),
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
    columns: astColumns.map((column, index) => projectColumn(source, column, irColumns[index] ?? null, ports, index)),
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
  const tag = kind === 'column' ? 'ColumnMenu' : 'CellMenu'
  const menu = table.children.find(
    (node): node is RComponentSFC_AST_ElementNode => node.kind === 'element' && node.tag === tag,
  ) ?? (kind === 'row'
    ? table.children.find(
      (node): node is RComponentSFC_AST_ElementNode => node.kind === 'element' && node.tag === 'RowMenu',
    ) ?? null
    : null)
  const tableMode = kind === 'column' ? readProp(irTable, 'column-menu', 'columnMenu') : null
  const mode = kind === 'column'
    ? tableMode?.kind === 'expression'
      ? 'source'
      : sourceValueText(tableMode) === 'disabled'
        ? 'disabled'
        : menu ? 'custom' : 'default'
    : menu ? 'custom' : 'none'

  if (!menu) {
    return { kind, mode, sourceOwned: mode === 'source', items: [] }
  }
  const sourceOwned = source.slice(menu.range.start, menu.range.end).includes('<!--')
    || menu.children.some(node => node.kind === 'element' && node.tag !== 'MenuItem' && node.tag !== 'MenuSeparator')
  return {
    kind,
    mode,
    sourceOwned,
    sourceRange: menu.range,
    items: menu.children.flatMap<ComponentSFCTableMenuNodeProjection>((node, index) => {
      if (node.kind !== 'element') {
        return []
      }
      if (node.tag === 'MenuSeparator') {
        return [{
          kind: 'separator',
          id: staticAttribute(node, 'id') || `separator-${index}`,
          sourceRange: node.range,
        }]
      }
      if (node.tag !== 'MenuItem') {
        return []
      }
      const action = visualAttribute(node, 'action')
      const itemSourceOwned = sourceOwned
        || (action?.kind === 'expression' && !isActionPortReference(action.source, ports))
        || node.attributes.some(attribute => !['id', 'label', 'action', 'input', 'icon', 'disabled'].includes(attribute.name))
        || node.directives.some(directive => directive.name !== 'if')
      return [{
        kind: 'item',
        id: staticAttribute(node, 'id') || staticAttribute(node, 'action') || `item-${index}`,
        label: visualAttribute(node, 'label'),
        action,
        input: visualAttribute(node, 'input'),
        icon: visualAttribute(node, 'icon'),
        visible: visualDirective(node, 'if'),
        disabled: visualAttribute(node, 'disabled'),
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
  if (!reference) {
    return false
  }

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
    if (identity) {
      result.set(identity, { identity, source: 'external' })
    }
  }
  for (const identity of Object.values(TABLE_RUNTIME_ACTION_IDS)) {
    result.set(identity, { identity, source: 'intrinsic' })
  }
  for (const identity of Object.values(BUILTIN_ACTION_IDS)) {
    result.set(identity, { identity, source: 'built-in' })
  }
  for (const port of ports?.require.actions ?? []) {
    result.set(port.name, { identity: port.name, source: 'required' })
  }
  for (const port of ports?.provides.actions ?? []) {
    if (port.forwardedFrom && port.forwardedFrom.nodeId !== table?.id) {
      continue
    }
    result.set(port.name, {
      identity: port.name,
      source: port.forwardedFrom ? 'forwarded' : 'provided',
    })
  }
  return [...result.values()].sort((left, right) => left.identity.localeCompare(right.identity))
}

function visualAttribute(node: RComponentSFC_AST_ElementNode, name: string): ComponentSFCVisualSourceValue | null {
  const attribute = node.attributes.find(item => item.name === name)
  if (!attribute) {
    return null
  }
  if (attribute.dynamic) {
    return { kind: 'expression', source: attribute.value ?? '' }
  }
  if (attribute.value == null) {
    return { kind: 'boolean', value: true }
  }
  return { kind: 'literal', value: attribute.value }
}

function visualDirective(node: RComponentSFC_AST_ElementNode, name: string): ComponentSFCVisualSourceValue | null {
  const directive = node.directives.find(item => item.name === name)
  return directive?.expression != null ? { kind: 'expression', source: directive.expression } : null
}

function staticAttribute(node: RComponentSFC_AST_ElementNode, name: string): string {
  const value = visualAttribute(node, name)
  return value?.kind === 'literal' ? String(value.value ?? '').trim() : ''
}

function sourceValueText(value: ComponentSFCVisualSourceValue | null): string {
  if (!value) {
    return ''
  }
  return value.kind === 'expression' ? value.source : String(value.value ?? '')
}

function projectColumn(
  source: string,
  ast: RComponentSFC_AST_ElementNode,
  ir: RComponentSFC_IR_ElementNode | null,
  ports: ComponentSFCPortManifest | null,
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
    editing: projectColumnCellEditing(source, ast, ir, cellNode),
    interactions: projectColumnCellInteractions(cellNode),
    cellMenu: projectColumnCellMenu(source, ast, ir, ports),
    hasCustomCell: cell.hasCustomCell,
    cellSource: cell.source,
    sourceRange: ast.range,
  }
}

function projectColumnCellMenu(
  source: string,
  column: RComponentSFC_AST_ElementNode,
  irColumn: RComponentSFC_IR_ElementNode | null,
  ports: ComponentSFCPortManifest | null,
): ComponentSFCTableMenuProjection {
  const menu = column.children.find(
    (node): node is RComponentSFC_AST_ElementNode => node.kind === 'element' && node.tag === 'CellMenu',
  ) ?? null
  const modeValue = readProp(irColumn, 'cell-menu', 'cellMenu')
  if (!menu) {
    return {
      kind: 'row',
      mode: sourceValueText(modeValue) === 'none' ? 'none' : 'default',
      sourceOwned: modeValue?.kind === 'expression',
      items: [],
    }
  }
  return projectMenu(source, column, irColumn, ports, 'row')
}

const CELL_INTERACTION_FLAGS = new Set<ComponentSFCTableCellInteractionFlag>([
  'stop',
  'prevent',
  'self',
  'once',
  'capture',
  'passive',
])
const CELL_INTERACTION_MODIFIERS = new Set<ComponentSFCTableCellInteractionModifier>([
  'ctrl',
  'shift',
  'alt',
  'meta',
  'mod',
  'altGraph',
  'exact',
])

function projectColumnCellEditing(
  source: string,
  column: RComponentSFC_AST_ElementNode,
  irColumn: RComponentSFC_IR_ElementNode | null,
  cell: RComponentSFC_AST_ElementNode | null,
): ComponentSFCTableCellEditingProjection {
  if (source.slice(column.range.start, column.range.end).includes('<!--')) {
    return sourceOwnedCellEditing(
      false,
      'source',
      null,
      column.range,
      'Колонка содержит комментарии или произвольную разметку. Редактирование настраивается во вкладке Source.',
    )
  }

  const children = (cell?.children ?? column.children).filter(isSemanticRoot)
  const node = children.length === 1 && children[0]?.kind === 'element' ? children[0] : null
  if (!node) {
    return sourceOwnedCellEditing(
      false,
      children.length ? 'source' : 'unavailable',
      null,
      cell?.range ?? column.range,
      children.length
        ? 'Для визуальной настройки нужен один корневой Tag или Component внутри колонки.'
        : 'Сначала выберите Tag или Component во вкладке «Данные».',
    )
  }

  const editableDeclarations = node.attributes.filter(attribute => attribute.name === 'editable')
  const enabled = node.tag === 'Editable' || editableDeclarations.length > 0
  const irNode = findIrElementBySourceStart(irColumn, node.range.start)
  const sourceMode: ComponentSFCTableCellEditingProjection['mode'] = node.tag === 'Editable'
    ? 'custom'
    : node.tag === 'Component' || !isComponentSFCBuiltInTag(node.tag)
      ? 'component'
      : 'source'

  if (node.tag === 'Editable') {
    const variants = readCanonicalEditableVariants(source, node)
    if (!variants) {
      return sourceOwnedCellEditing(
        true,
        'custom',
        node.tag,
        node.range,
        'Visual editor поддерживает Editable с одним Variant default и одним Variant edit, содержащими по одному элементу.',
      )
    }
    const editOnDeclarations = node.attributes.filter(attribute => attribute.name === 'edit-on')
    if (editOnDeclarations.length > 1) {
      return sourceOwnedCellEditing(true, 'custom', node.tag, node.range, 'edit-on объявлен несколько раз.')
    }
    const reaction = projectEventReaction(node, 'edited')
    const projectedTriggers = projectEditTriggers(editOnDeclarations[0] ?? null)
    const outcomes = projectEditOutcomes(node, irNode?.editable ?? null)
    if (!outcomes.editable) {
      return sourceOwnedCellEditing(true, 'custom', node.tag, node.range, outcomes.message ?? 'Настройки выхода управляются Source.')
    }
    const editor = projectEditableVariantElement(
      source,
      irColumn,
      variants.edit,
      'editable-edit',
    )
    return {
      editable: projectedTriggers.editable,
      enabled: true,
      mode: 'custom',
      tag: node.tag,
      triggers: projectedTriggers.triggers,
      usesDefaultTrigger: projectedTriggers.usesDefaultTrigger,
      suffixes: projectedTriggers.suffixes,
      reaction,
      cancel: outcomes.cancel,
      commit: outcomes.commit,
      editor,
      editorImplicit: false,
      sourceRange: node.range,
      message: projectedTriggers.message,
    }
  }

  const nestedEditableCount = countNestedEditableElements(node)
  if (!enabled && nestedEditableCount > 0) {
    return sourceOwnedCellEditing(
      true,
      'source',
      node.tag,
      node.range,
      `${nestedEditableSummary(nestedEditableCount)} Настройки отдельных editor-ов доступны во вкладке Source.`,
    )
  }

  if (!EDITABLE_PRIMITIVE_TAGS.has(node.tag)) {
    const hasLocalEditingBehavior = node.attributes.some(attribute => (
      attribute.name === 'edit-on'
      || attribute.name === 'cancel-on'
      || attribute.name === 'commit-on'
    )) || node.directives.some(directive => (
      directive.name === 'on' && directive.argument?.trim() === 'edited'
    ))
    const hasStructuralDirective = node.directives.some(directive => (
      directive.name === 'if'
      || directive.name === 'else-if'
      || directive.name === 'else'
      || directive.name === 'for'
    ))
    if (!enabled && !hasLocalEditingBehavior && !hasStructuralDirective) {
      const reaction = projectEventReaction(node, 'edited')
      const projectedTriggers = projectEditTriggers(null)
      const outcomes = projectEditOutcomes(node, irNode?.editable ?? null)
      return {
        editable: true,
        enabled: false,
        mode: sourceMode,
        tag: node.tag,
        triggers: projectedTriggers.triggers,
        usesDefaultTrigger: projectedTriggers.usesDefaultTrigger,
        suffixes: projectedTriggers.suffixes,
        reaction,
        cancel: outcomes.cancel,
        commit: outcomes.commit,
        editor: null,
        editorImplicit: false,
        sourceRange: node.range,
        message: 'Выберите editor, чтобы создать составной Editable с вариантами отображения и редактирования.',
      }
    }
    return sourceOwnedCellEditing(
      enabled,
      sourceMode,
      node.tag,
      node.range,
      node.tag === 'Editable'
        ? 'Составной Editable с Variant сохраняется без преобразований и настраивается во вкладке Source.'
        : enabled
          ? `Editable-поведение ${node.tag} сохраняется без преобразований и настраивается во вкладке Source.`
          : 'Встроенный визуальный editor доступен только для Text, Number и DateTime.',
    )
  }

  if (editableDeclarations.length > 1) {
    return sourceOwnedCellEditing(enabled, 'primitive', node.tag, node.range, 'Атрибут editable объявлен несколько раз.')
  }
  const editableAttribute = editableDeclarations[0] ?? null
  if (editableAttribute && (editableAttribute.dynamic || editableAttribute.value != null)) {
    return sourceOwnedCellEditing(enabled, 'primitive', node.tag, node.range, 'editable должен быть статическим boolean-атрибутом.')
  }

  const editOnDeclarations = node.attributes.filter(attribute => attribute.name === 'edit-on')
  if (editOnDeclarations.length > 1) {
    return sourceOwnedCellEditing(enabled, 'primitive', node.tag, node.range, 'edit-on объявлен несколько раз.')
  }
  const reaction = projectEventReaction(node, 'edited')
  const projectedTriggers = projectEditTriggers(editOnDeclarations[0] ?? null)
  const outcomes = projectEditOutcomes(node, irNode?.editable ?? null)
  if (!outcomes.editable) {
    return sourceOwnedCellEditing(enabled, 'primitive', node.tag, node.range, outcomes.message ?? 'Настройки выхода управляются Source.')
  }
  if (!projectedTriggers.editable) {
    return {
      ...projectedTriggers,
      enabled,
      mode: 'primitive',
      tag: node.tag,
      reaction,
      cancel: outcomes.cancel,
      commit: outcomes.commit,
      editor: projectPrimitiveEditorElement(node),
      editorImplicit: true,
      sourceRange: node.range,
    }
  }

  return {
    editable: true,
    enabled,
    mode: 'primitive',
    tag: node.tag,
    triggers: projectedTriggers.triggers,
    usesDefaultTrigger: projectedTriggers.usesDefaultTrigger,
    suffixes: projectedTriggers.suffixes,
    reaction,
    cancel: outcomes.cancel,
    commit: outcomes.commit,
    editor: projectPrimitiveEditorElement(node),
    editorImplicit: true,
    sourceRange: node.range,
  }
}

function sourceOwnedCellEditing(
  enabled: boolean,
  mode: ComponentSFCTableCellEditingProjection['mode'],
  tag: string | null,
  sourceRange: RComponentSFC_AST_ElementNode['range'],
  message: string,
): ComponentSFCTableCellEditingProjection {
  return {
    editable: false,
    enabled,
    mode,
    tag,
    triggers: [],
    usesDefaultTrigger: false,
    suffixes: [],
    reaction: {
      editable: false,
      source: null,
      suffixes: [],
      sourceRange,
      message,
    },
    cancel: sourceOwnedEditOutcome(message),
    commit: sourceOwnedEditOutcome(message),
    editor: null,
    editorImplicit: false,
    sourceRange,
    message,
  }
}

function countNestedEditableElements(root: RComponentSFC_AST_ElementNode): number {
  let count = 0
  for (const child of root.children) {
    if (child.kind !== 'element') {
      continue
    }
    if (child.tag === 'Editable' || child.attributes.some(attribute => attribute.name === 'editable')) {
      count += 1
    }
    count += countNestedEditableElements(child)
  }
  return count
}

function nestedEditableSummary(count: number): string {
  const modulo100 = count % 100
  const modulo10 = count % 10
  const suffix = modulo100 >= 11 && modulo100 <= 14
    ? 'элементов'
    : modulo10 === 1
      ? 'элемент'
      : modulo10 >= 2 && modulo10 <= 4
        ? 'элемента'
        : 'элементов'
  const predicate = modulo10 === 1 && modulo100 !== 11 ? 'найден' : 'найдено'
  return `Внутри ячейки ${predicate} ${count} editable-${suffix}.`
}

function sourceOwnedEditOutcome(message: string): ComponentSFCEditOutcomeProjection {
  return {
    editable: false,
    triggers: [],
    usesDefault: false,
    suffixes: [],
    message,
  }
}

function projectEditOutcomes(
  node: RComponentSFC_AST_ElementNode,
  editable: RComponentSFC_IR_ElementNode['editable'] | null,
): {
  editable: boolean
  cancel: ComponentSFCEditOutcomeProjection
  commit: ComponentSFCEditOutcomeProjection
  message?: string
} {
  const cancelDeclarations = node.attributes.filter(attribute => attribute.name === 'cancel-on')
  const commitDeclarations = node.attributes.filter(attribute => attribute.name === 'commit-on')
  if (cancelDeclarations.length > 1 || commitDeclarations.length > 1) {
    const message = cancelDeclarations.length > 1 ? 'cancel-on объявлен несколько раз.' : 'commit-on объявлен несколько раз.'
    return {
      editable: false,
      cancel: sourceOwnedEditOutcome(message),
      commit: sourceOwnedEditOutcome(message),
      message,
    }
  }
  const cancel = projectOutcomeTriggers(
    cancelDeclarations[0] ?? null,
    'cancel-on',
    projectInheritedOutcomeTriggers(editable?.cancelTriggers, [
      { event: 'keydown', key: ['Escape'], prevent: true, stop: true },
      { event: 'focusout' },
    ]),
  )
  const commit = projectOutcomeTriggers(
    commitDeclarations[0] ?? null,
    'commit-on',
    projectInheritedOutcomeTriggers(editable?.commitTriggers, [
      { event: 'keydown', key: ['Enter'], prevent: true },
    ]),
  )
  return {
    editable: cancel.editable && commit.editable,
    cancel,
    commit,
    message: cancel.message ?? commit.message,
  }
}

function projectInheritedOutcomeTriggers(
  value: RComponentSFC_IR_Value | undefined,
  fallback: ComponentSFCInteractionTrigger[],
): ComponentSFCInteractionTriggerProjection[] {
  const source = value?.kind === 'literal' ? value.value : fallback
  const triggers = normalizeComponentSFCInteractionTriggers(source)
  return triggers.map(projectNormalizedInteractionTrigger)
}

function projectNormalizedInteractionTrigger(
  trigger: ComponentSFCInteractionTrigger,
): ComponentSFCInteractionTriggerProjection {
  const flags: ComponentSFCInteractionTriggerProjection['flags'] = {}
  for (const flag of CELL_INTERACTION_FLAGS) {
    if (trigger[flag] === true) {
      flags[flag] = true
    }
  }
  return {
    event: trigger.event,
    key: [...(trigger.key ?? [])],
    code: [...(trigger.code ?? [])],
    held: trigger.held
      ? {
          key: [...(trigger.held.key ?? [])],
          code: [...(trigger.held.code ?? [])],
          match: trigger.held.match ?? 'all',
          exact: trigger.held.exact ?? false,
        }
      : null,
    modifiers: { ...(trigger.modifiers ?? {}) },
    repeat: trigger.repeat ?? null,
    composing: trigger.composing ?? null,
    button: trigger.button ?? null,
    flags,
  }
}

function projectOutcomeTriggers(
  attribute: RComponentSFC_AST_ElementNode['attributes'][number] | null,
  name: 'cancel-on' | 'commit-on',
  defaults: ComponentSFCInteractionTriggerProjection[],
): ComponentSFCEditOutcomeProjection {
  const projected = projectEditTriggers(attribute, defaults, name)
  return {
    editable: projected.editable,
    triggers: projected.triggers,
    usesDefault: projected.usesDefaultTrigger,
    suffixes: projected.suffixes,
    message: projected.message,
  }
}

interface CanonicalEditableVariants {
  default: RComponentSFC_AST_ElementNode
  edit: RComponentSFC_AST_ElementNode
}

function readCanonicalEditableVariants(
  source: string,
  editable: RComponentSFC_AST_ElementNode,
): CanonicalEditableVariants | null {
  if (source.slice(editable.range.start, editable.range.end).includes('<!--')) {
    return null
  }
  const variants = editable.children.filter(isSemanticRoot)
  if (variants.length !== 2 || variants.some(node => node.kind !== 'element' || node.tag !== 'Variant')) {
    return null
  }

  const result: Partial<CanonicalEditableVariants> = {}
  for (const rawVariant of variants) {
    if (rawVariant.kind !== 'element') {
      return null
    }
    const names = rawVariant.attributes.filter(attribute => attribute.name === 'name')
    const name = names.length === 1 && !names[0]!.dynamic ? names[0]!.value?.trim() : null
    if (name !== 'default' && name !== 'edit') {
      return null
    }
    const children = rawVariant.children.filter(isSemanticRoot)
    if (children.length !== 1 || children[0]!.kind !== 'element') {
      return null
    }
    if (result[name]) {
      return null
    }
    result[name] = children[0]!
  }
  return result.default && result.edit
    ? result as CanonicalEditableVariants
    : null
}

function projectEditableVariantElement(
  source: string,
  irColumn: RComponentSFC_IR_ElementNode | null,
  node: RComponentSFC_AST_ElementNode,
  syntax: 'editable-default' | 'editable-edit',
): ComponentSFCTableEditableElementProjection {
  const irNode = findIrElementBySourceStart(irColumn, node.range.start)
  const identity = node.tag === 'Component'
    ? staticAttribute(node, 'is') || null
    : irNode?.tag === 'Component'
      ? readLiteralString(irNode.props.is)
      : null
  const projection = projectSingleCellElement(source, node, node, identity, syntax)
  return projection.kind === 'default' ? { kind: 'source' } : projection
}

function projectPrimitiveEditorElement(
  node: RComponentSFC_AST_ElementNode,
): ComponentSFCTableEditableElementProjection {
  if (!isVisualCellTag(node.tag)) {
    return { kind: 'source' }
  }
  return {
    kind: 'tag',
    tag: node.tag,
    syntax: 'direct',
    bindings: projectCellBindings(node, new Set(['editable', 'edit-on', 'cancel-on', 'commit-on'])),
  }
}

function findIrElementBySourceStart(
  node: RComponentSFC_IR_ElementNode | null,
  start: number,
): RComponentSFC_IR_ElementNode | null {
  if (!node) {
    return null
  }
  if (node.sourceRange?.start === start) {
    return node
  }
  for (const child of node.children) {
    if (child.kind !== 'element') {
      continue
    }
    const match = findIrElementBySourceStart(child, start)
    if (match) {
      return match
    }
  }
  return null
}

function projectEventReaction(
  node: RComponentSFC_AST_ElementNode,
  eventName: string,
): ComponentSFCEventReactionProjection {
  const declarations = node.directives.filter(
    directive => directive.name === 'on' && directive.argument?.trim() === eventName,
  )
  if (declarations.length > 1) {
    return {
      editable: false,
      source: null,
      suffixes: [],
      sourceRange: node.range,
      message: `@${eventName} объявлен несколько раз. Измените его во вкладке Source.`,
    }
  }

  const declaration = declarations[0] ?? null
  if (!declaration) {
    return { editable: true, source: null, suffixes: [] }
  }
  const suffixes = declaration.modifiers.filter(
    (modifier): modifier is ComponentSFCTableCellInteractionFlag => CELL_INTERACTION_FLAGS.has(modifier as ComponentSFCTableCellInteractionFlag),
  )
  const unsupportedSuffix = declaration.modifiers.find(
    modifier => !CELL_INTERACTION_FLAGS.has(modifier as ComponentSFCTableCellInteractionFlag),
  )
  if (unsupportedSuffix) {
    return {
      editable: false,
      source: declaration.expression?.trim() || null,
      suffixes,
      sourceRange: declaration.range,
      message: `Modifier .${unsupportedSuffix} не поддерживается visual editor-ом @${eventName}.`,
    }
  }
  const source = declaration.expression?.trim() ?? ''
  if (!source) {
    return {
      editable: false,
      source: null,
      suffixes,
      sourceRange: declaration.range,
      message: `@${eventName} требует локальную reaction.`,
    }
  }
  return {
    editable: true,
    source,
    suffixes,
    sourceRange: declaration.range,
  }
}

function projectEditTriggers(
  attribute: RComponentSFC_AST_ElementNode['attributes'][number] | null,
  defaults: ComponentSFCInteractionTriggerProjection[] = [createInteractionTrigger('click')],
  attributeName = 'edit-on',
): Pick<ComponentSFCTableCellEditingProjection, 'editable' | 'triggers' | 'usesDefaultTrigger' | 'suffixes' | 'message'> {
  if (!attribute) {
    return {
      editable: true,
      triggers: defaults,
      usesDefaultTrigger: true,
      suffixes: [],
    }
  }

  const suffixes = attribute.modifiers.filter(
    (modifier): modifier is ComponentSFCTableCellInteractionFlag => CELL_INTERACTION_FLAGS.has(modifier as ComponentSFCTableCellInteractionFlag),
  )
  const unsupportedSuffix = attribute.modifiers.find(
    modifier => !CELL_INTERACTION_FLAGS.has(modifier as ComponentSFCTableCellInteractionFlag),
  )
  if (unsupportedSuffix) {
    return {
      editable: false,
      triggers: [],
      usesDefaultTrigger: false,
      suffixes,
      message: `Modifier .${unsupportedSuffix} не поддерживается visual editor-ом ${attributeName}.`,
    }
  }
  const raw = attribute.value?.trim() ?? ''
  if (!raw) {
    return { editable: false, triggers: [], usesDefaultTrigger: false, suffixes, message: `${attributeName} требует непустое событие.` }
  }
  if (!attribute.dynamic) {
    return {
      editable: true,
      triggers: [createInteractionTrigger(raw)],
      usesDefaultTrigger: false,
      suffixes,
    }
  }

  try {
    const expression: any = parseExpression(raw, { sourceType: 'module', plugins: ['typescript'] })
    const nodes = expression.type === 'ArrayExpression' ? expression.elements : [expression]
    const triggers = (nodes as any[]).map(node => projectInteractionTrigger(node))
    if (!triggers.length || triggers.some(trigger => !trigger)) {
      return { editable: false, triggers: [], usesDefaultTrigger: false, suffixes, message: `Сложный ${attributeName} редактируется во вкладке Source.` }
    }
    return {
      editable: true,
      triggers: triggers as ComponentSFCInteractionTriggerProjection[],
      usesDefaultTrigger: false,
      suffixes,
    }
  }
  catch {
    return { editable: false, triggers: [], usesDefaultTrigger: false, suffixes, message: `Не удалось разобрать ${attributeName}. Исправьте выражение во вкладке Source.` }
  }
}

function createInteractionTrigger(event: string): ComponentSFCInteractionTriggerProjection {
  return {
    event,
    key: [],
    code: [],
    held: null,
    modifiers: {},
    repeat: null,
    composing: null,
    button: null,
    flags: {},
  }
}

function projectColumnCellInteractions(
  cell: RComponentSFC_AST_ElementNode | null,
): ComponentSFCTableCellInteractionsProjection {
  const attribute = cell?.attributes.find(item => item.name === 'on') ?? null
  if (!attribute) {
    return { editable: true, rules: [], suffixes: [] }
  }

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
    if (!rules.length || rules.some(rule => !rule)) {
      return sourceOwnedInteractions(attribute.range, suffixes, 'Сложная :on-аннотация редактируется во вкладке Source.')
    }
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

const INTERACTION_TRIGGER_FIELDS = new Set([
  'event',
  'key',
  'code',
  'held',
  'modifiers',
  'repeat',
  'composing',
  'button',
  ...CELL_INTERACTION_FLAGS,
])

function projectCellInteractionRule(
  node: any,
  source: string,
): ComponentSFCTableCellInteractionRuleProjection | null {
  const trigger = projectInteractionTrigger(node, true)
  if (!trigger || node?.type !== 'ObjectExpression') {
    return null
  }
  const properties = babelObjectProperties(node)
  if (!properties) {
    return null
  }
  const reaction = properties.get('reaction')
  if (!reaction) {
    return null
  }
  if ([...properties.keys()].some(name => !INTERACTION_TRIGGER_FIELDS.has(name) && name !== 'reaction')) {
    return null
  }

  return {
    ...trigger,
    reactionSource: source.slice(reaction.start ?? 0, reaction.end ?? source.length),
  }
}
function projectInteractionTrigger(node: any, allowReaction = false): ComponentSFCInteractionTriggerProjection | null {
  const literalEvent = babelLiteralString(node)
  if (literalEvent) {
    return createInteractionTrigger(literalEvent)
  }
  if (node?.type !== 'ObjectExpression') {
    return null
  }
  const properties = babelObjectProperties(node)
  if (!properties) {
    return null
  }

  const event = babelLiteralString(properties.get('event'))
  if (!event) {
    return null
  }
  const key = babelStringList(properties.get('key'))
  const code = babelStringList(properties.get('code'))
  if (key === null || code === null) {
    return null
  }
  const held = projectHeldKeys(properties.get('held'))
  const modifiers = projectInteractionModifiers(properties.get('modifiers'))
  if (held === undefined || modifiers === null) {
    return null
  }

  const flags: ComponentSFCTableCellInteractionRuleProjection['flags'] = {}
  for (const flag of CELL_INTERACTION_FLAGS) {
    const value = babelOptionalBoolean(properties.get(flag))
    if (value === undefined && properties.has(flag)) {
      return null
    }
    if (value != null) {
      flags[flag] = value
    }
  }
  const repeat = babelNullableBoolean(properties.get('repeat'))
  const composing = babelNullableBoolean(properties.get('composing'))
  const button = babelNullableNumber(properties.get('button'))
  if (repeat === undefined || composing === undefined || button === undefined) {
    return null
  }

  if ([...properties.keys()].some(name => !INTERACTION_TRIGGER_FIELDS.has(name) && (!allowReaction || name !== 'reaction'))) {
    return null
  }

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
  }
}

function projectHeldKeys(node: any): ComponentSFCTableCellInteractionRuleProjection['held'] | null | undefined {
  if (node == null) {
    return null
  }
  if (node.type !== 'ObjectExpression') {
    return undefined
  }
  const values = babelObjectProperties(node)
  if (!values) {
    return undefined
  }
  const key = babelStringList(values.get('key'))
  const code = babelStringList(values.get('code'))
  const match = values.has('match') ? babelLiteralString(values.get('match')) : 'all'
  const exact = values.has('exact') ? babelOptionalBoolean(values.get('exact')) : false
  if (key === null || code === null || (match !== 'all' && match !== 'any') || exact == null) {
    return undefined
  }
  if ([...values.keys()].some(name => !['key', 'code', 'match', 'exact'].includes(name))) {
    return undefined
  }
  return { key: key ?? [], code: code ?? [], match, exact }
}

function projectInteractionModifiers(
  node: any,
): ComponentSFCTableCellInteractionRuleProjection['modifiers'] | null {
  if (node == null) {
    return {}
  }
  if (node.type !== 'ObjectExpression') {
    return null
  }
  const values = babelObjectProperties(node)
  if (!values) {
    return null
  }
  const result: ComponentSFCTableCellInteractionRuleProjection['modifiers'] = {}
  for (const [name, valueNode] of values) {
    if (!CELL_INTERACTION_MODIFIERS.has(name as ComponentSFCTableCellInteractionModifier)) {
      return null
    }
    const value = babelOptionalBoolean(valueNode)
    if (value == null) {
      return null
    }
    result[name as ComponentSFCTableCellInteractionModifier] = value
  }
  return result
}

function babelObjectProperties(node: any): Map<string, any> | null {
  const result = new Map<string, any>()
  for (const property of node.properties ?? []) {
    if (property?.type !== 'ObjectProperty' || property.computed) {
      return null
    }
    const name = babelPropertyName(property)
    if (!name || result.has(name)) {
      return null
    }
    result.set(name, property.value)
  }
  return result
}

function babelPropertyName(property: any): string | null {
  if (property?.key?.type === 'Identifier') {
    return property.key.name
  }
  if (property?.key?.type === 'StringLiteral') {
    return String(property.key.value)
  }
  return null
}

function babelLiteralString(node: any): string | null {
  if (node?.type === 'StringLiteral') {
    return String(node.value)
  }
  if (node?.type === 'TemplateLiteral' && node.expressions?.length === 0) {
    return String(node.quasis?.[0]?.value?.cooked ?? '')
  }
  return null
}

function babelStringList(node: any): string[] | null | undefined {
  if (node == null) {
    return undefined
  }
  const single = babelLiteralString(node)
  if (single != null) {
    return [single]
  }
  if (node.type !== 'ArrayExpression') {
    return null
  }
  const result = node.elements.map((item: any) => babelLiteralString(item))
  return result.some((item: string | null) => item == null) ? null : result as string[]
}

function babelOptionalBoolean(node: any): boolean | null | undefined {
  if (node == null) {
    return null
  }
  return node.type === 'BooleanLiteral' ? node.value === true : undefined
}

function babelNullableBoolean(node: any): boolean | null | undefined {
  if (node == null) {
    return null
  }
  return babelOptionalBoolean(node)
}

function babelNullableNumber(node: any): number | null | undefined {
  if (node == null) {
    return null
  }
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
    const roots = cell.children.filter(isSemanticRoot)
    const root = roots.length === 1 && roots[0]?.kind === 'element' ? roots[0] : null
    const variants = root?.tag === 'Editable' ? readCanonicalEditableVariants(source, root) : null
    return {
      projection: variants
        ? projectEditableVariantElement(source, irColumn, variants.default, 'editable-default')
        : projectManagedCell(source, cell),
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
  if (!cell) {
    return { kind: 'default' }
  }

  if (source.slice(cell.range.start, cell.range.end).includes('<!--')) {
    return { kind: 'source' }
  }

  const children = cell.children.filter(isSemanticRoot)
  if (children.length === 0) {
    return { kind: 'component', identity: null, syntax: 'cell', bindings: [] }
  }

  const child = children.length === 1 && children[0].kind === 'element'
    ? children[0]
    : null
  if (!child) {
    return { kind: 'source' }
  }

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
  if (identity?.dynamic) {
    return { kind: 'source' }
  }

  const hasDynamicIs = child.directives.some((directive) => {
    const raw = source.slice(directive.range.start, directive.range.end).trim()
    return (directive.name === 'bind' && directive.argument === 'is')
      || raw.startsWith(':is')
      || raw.startsWith('v-bind:is')
  })
  if (hasDynamicIs) {
    return { kind: 'source' }
  }

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
  syntax: ComponentSFCTableVisualCellSyntax,
): ComponentSFCTableColumnProjection['cell'] {
  if (!child || source.slice(owner.range.start, owner.range.end).includes('<!--')) {
    return { kind: 'source' }
  }
  if (componentIdentity) {
    return {
      kind: 'component',
      identity: componentIdentity,
      syntax,
      bindings: projectCellBindings(child, new Set(['is'])),
    }
  }
  if (isVisualCellTag(child.tag)) {
    return {
      kind: 'tag',
      tag: child.tag,
      syntax,
      bindings: projectCellBindings(child),
    }
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
  if (raw.startsWith(':') || raw.startsWith('v-bind:')) {
    return toVisualValue(value)
  }
  return directive.expression == null
    ? { kind: 'boolean', value: true }
    : { kind: 'literal', value: directive.expression }
}

function readDirective(directive: RComponentSFC_AST_Directive): ComponentSFCVisualSourceValue {
  if (directive.expression == null) {
    return { kind: 'boolean', value: true }
  }
  return { kind: 'literal', value: directive.expression }
}

function readProp(
  node: RComponentSFC_IR_ElementNode | null,
  ...names: string[]
): ComponentSFCVisualSourceValue | null {
  if (!node) {
    return null
  }

  for (const name of names) {
    if (node.props[name]) {
      return toVisualValue(node.props[name])
    }
  }

  return null
}

function toVisualValue(value: RComponentSFC_IR_Value): ComponentSFCVisualSourceValue {
  if (value.kind === 'expression') {
    return { kind: 'expression', source: value.source }
  }
  if (typeof value.value === 'boolean') {
    return { kind: 'boolean', value: value.value }
  }
  return { kind: 'literal', value: value.value }
}

function valueLabel(value: ComponentSFCVisualSourceValue | null): string {
  if (!value) {
    return ''
  }
  if (value.kind === 'expression') {
    return value.source
  }
  return String(value.value ?? '')
}
