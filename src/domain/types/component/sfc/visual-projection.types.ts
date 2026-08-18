import type { RComponentDiagnostic } from '@/domain/types/component/component-core.types'
import type { TypeSourceDefinition } from '@/domain/types/source/type-source.types'
import type { RComponentSFC_IR_Tag } from './ir.types'
import type { RComponentSFC_SourceRange } from './location.types'

/** Значение SFC source, подготовленное для безопасного отображения в visual editor. */
export type ComponentSFCVisualSourceValue
  = | { kind: 'boolean', value: boolean }
    | { kind: 'literal', value: unknown }
    | { kind: 'expression', source: string }

/** Один attribute исходного SFC-узла без привязки к конкретному UI framework. */
export interface ComponentSFCVisualAttribute {
  name: string
  value: ComponentSFCVisualSourceValue
  sourceRange?: RComponentSFC_SourceRange
}

/** Редактируемый prop binding единственного управляемого элемента колонки Table. */
export type ComponentSFCTableCellBindingProjection = ComponentSFCVisualAttribute

export type ComponentSFCTableCellInteractionModifier
  = 'ctrl' | 'shift' | 'alt' | 'meta' | 'mod' | 'altGraph' | 'exact'

export type ComponentSFCTableCellInteractionFlag
  = 'stop' | 'prevent' | 'self' | 'once' | 'capture' | 'passive'

/** Visual-editor-safe projection of one static Cell `:on` rule. */
export interface ComponentSFCTableCellInteractionRuleProjection {
  event: string
  key: string[]
  code: string[]
  held: {
    key: string[]
    code: string[]
    match: 'all' | 'any'
    exact: boolean
  } | null
  modifiers: Partial<Record<ComponentSFCTableCellInteractionModifier, boolean>>
  repeat: boolean | null
  composing: boolean | null
  button: number | null
  flags: Partial<Record<ComponentSFCTableCellInteractionFlag, boolean>>
  reactionSource: string
}

/** Source-preserving Cell interaction read-model used by the Table visual editor. */
export interface ComponentSFCTableCellInteractionsProjection {
  editable: boolean
  rules: ComponentSFCTableCellInteractionRuleProjection[]
  suffixes: ComponentSFCTableCellInteractionFlag[]
  sourceRange?: RComponentSFC_SourceRange
  message?: string
}

/** Способ, которым содержимое ячейки представлено в простом visual editor. */
export type ComponentSFCTableVisualCellTag = Exclude<
  RComponentSFC_IR_Tag,
  'Component' | 'Table' | 'Column' | 'Cell' | 'ColumnMenu' | 'RowMenu' | 'MenuItem' | 'MenuSeparator'
>

export type ComponentSFCTableCellProjection
  = | { kind: 'default' }
    | {
      kind: 'component'
      identity: string | null
      syntax: 'cell' | 'direct'
      bindings: ComponentSFCTableCellBindingProjection[]
    }
    | {
      kind: 'tag'
      tag: ComponentSFCTableVisualCellTag
      syntax: 'cell' | 'direct'
      bindings: ComponentSFCTableCellBindingProjection[]
    }
    | { kind: 'source' }

/** Registry context required to resolve direct user component tags while reading Source. */
export interface ComponentSFCVisualInspectionOptions {
  resolveComponentTag?: (tag: string) => string | null
  resolveTypeDefinition?: (identity: string) => TypeSourceDefinition | null
  /** Direct Action identities available to source-authored MenuItem bindings. */
  actionIdentities?: Iterable<string>
}

/** Visual read-model одной прямой Column внутри корневого Table. */
export interface ComponentSFCTableColumnProjection {
  id: string
  index: number
  key: ComponentSFCVisualSourceValue | null
  title: ComponentSFCVisualSourceValue | null
  width: ComponentSFCVisualSourceValue | null
  sortable: ComponentSFCVisualSourceValue | null
  sort: ComponentSFCVisualSourceValue | null
  sortBy: ComponentSFCVisualSourceValue | null
  pinnable: ComponentSFCVisualSourceValue | null
  attributes: ComponentSFCVisualAttribute[]
  cell: ComponentSFCTableCellProjection
  interactions: ComponentSFCTableCellInteractionsProjection
  hasCustomCell: boolean
  cellSource: string | null
  sourceRange: RComponentSFC_SourceRange
}

export type ComponentSFCTableVisualMenuKind = 'column' | 'row'
export type ComponentSFCTableVisualMenuMode = 'default' | 'disabled' | 'none' | 'custom' | 'source'

export interface ComponentSFCTableMenuActionOption {
  identity: string
  source: 'intrinsic' | 'built-in' | 'external' | 'required' | 'provided' | 'forwarded'
}

export type ComponentSFCTableMenuNodeProjection
  = | {
    kind: 'separator'
    id: string
    sourceRange: RComponentSFC_SourceRange
  }
    | {
      kind: 'item'
      id: string
      label: ComponentSFCVisualSourceValue | null
      action: ComponentSFCVisualSourceValue | null
      input: ComponentSFCVisualSourceValue | null
      icon: ComponentSFCVisualSourceValue | null
      sourceOwned: boolean
      sourceRange: RComponentSFC_SourceRange
    }

export interface ComponentSFCTableMenuProjection {
  kind: ComponentSFCTableVisualMenuKind
  mode: ComponentSFCTableVisualMenuMode
  sourceOwned: boolean
  items: ComponentSFCTableMenuNodeProjection[]
  sourceRange?: RComponentSFC_SourceRange
}

/** Минимальные source-preserving операции visual editor таблицы. */
export type ComponentSFCTableSourcePatch
  = | {
    type: 'add-column'
    title?: string
    key?: string
  }
    | {
      type: 'remove-column'
      columnIndex: number
    }
    | {
      type: 'move-column'
      fromIndex: number
      toIndex: number
    }
    | {
      type: 'set-column-attribute'
      columnIndex: number
      name: 'key' | 'title' | 'width' | 'sortable' | 'sort' | 'sort-by'
      value: string | null
    }
    | {
      type: 'set-table-attribute'
      name: 'ref' | 'selection-mode' | 'selection-trigger' | 'paging' | 'page-size' | 'page-sizes' | 'default-pin' | 'default-sort' | 'default-hidden'
      value: string | null
    }
    | {
      type: 'set-column-component'
      columnIndex: number
      identity: string | null
      syntax?: 'cell' | 'direct'
    }
    | {
      type: 'set-column-tag'
      columnIndex: number
      tag: ComponentSFCTableVisualCellTag | null
      syntax?: 'cell' | 'direct'
    }
    | {
      type: 'set-column-cell-attribute'
      columnIndex: number
      name: string
      value: string | null
      valueKind: 'expression' | 'literal'
    }
    | {
      type: 'set-column-cell-on'
      columnIndex: number
      /** Complete object/array expression, or null to remove the annotation. */
      value: string | null
    }
    | {
      type: 'set-menu-mode'
      menu: ComponentSFCTableVisualMenuKind
      mode: 'default' | 'disabled' | 'none' | 'custom'
    }
    | {
      type: 'add-menu-node'
      menu: ComponentSFCTableVisualMenuKind
      node: 'item' | 'separator'
    }
    | {
      type: 'remove-menu-node'
      menu: ComponentSFCTableVisualMenuKind
      nodeIndex: number
    }
    | {
      type: 'move-menu-node'
      menu: ComponentSFCTableVisualMenuKind
      fromIndex: number
      toIndex: number
    }
    | {
      type: 'set-menu-item-attribute'
      menu: ComponentSFCTableVisualMenuKind
      nodeIndex: number
      name: 'label' | 'action' | 'input' | 'icon'
      value: string | null
      valueKind: 'expression' | 'literal'
    }

/** Результат точечного изменения SFC Table source. */
export interface ComponentSFCTableSourcePatchResult {
  ok: boolean
  source: string
  changed: boolean
  projection: ComponentSFCTableVisualProjection | null
  diagnostics: RComponentDiagnostic[]
  message?: string
}

/** Visual read-model SFC, template которого содержит один корневой Table. */
export interface ComponentSFCTableVisualProjection {
  kind: 'table'
  ref: ComponentSFCVisualSourceValue | null
  selectionMode: ComponentSFCVisualSourceValue | null
  selectionTrigger: ComponentSFCVisualSourceValue | null
  rows: ComponentSFCVisualSourceValue | null
  rowKey: ComponentSFCVisualSourceValue | null
  paging: ComponentSFCVisualSourceValue | null
  pageSize: ComponentSFCVisualSourceValue | null
  pageSizes: ComponentSFCVisualSourceValue | null
  sortMode: ComponentSFCVisualSourceValue | null
  defaultSort: ComponentSFCVisualSourceValue | null
  columnPin: ComponentSFCVisualSourceValue | null
  defaultPin: ComponentSFCVisualSourceValue | null
  defaultHidden: ComponentSFCVisualSourceValue | null
  columnMenu: ComponentSFCVisualSourceValue | null
  menus: {
    column: ComponentSFCTableMenuProjection
    row: ComponentSFCTableMenuProjection
  }
  menuActions: ComponentSFCTableMenuActionOption[]
  attributes: ComponentSFCVisualAttribute[]
  columns: ComponentSFCTableColumnProjection[]
  sourceRange: RComponentSFC_SourceRange
}

/** Результат выбора специализированного visual editor для SFC source. */
export interface ComponentSFCVisualInspection {
  support:
    | { kind: 'table' }
    | { kind: 'none', reason: 'source-empty' | 'template-missing' | 'root-count' | 'root-not-table' }
  projection: ComponentSFCTableVisualProjection | null
  diagnostics: RComponentDiagnostic[]
}
