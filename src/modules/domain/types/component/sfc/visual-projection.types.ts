import type { RComponentSFC_IR_Tag } from './ir.types'
import type { RComponentSFC_SourceRange } from './location.types'
import type { EndgeSFCEditingConfiguration } from '@/modules/configuration/domain/types/configuration.type'
import type { RComponentDiagnostic } from '@/modules/domain/types/component/component-core.types'
import type { TypeSourceDefinition } from '@/modules/source/domain/types/type-source.types'

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

/** UI-neutral projection одного статически разбираемого trigger взаимодействия. */
export interface ComponentSFCInteractionTriggerProjection {
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
}

/** UI-neutral projection одного статически разбираемого правила Cell `:on`. */
export interface ComponentSFCTableCellInteractionRuleProjection extends ComponentSFCInteractionTriggerProjection {
  reactionSource: string
}

/** Source-preserving read-model взаимодействий Cell для visual editor таблицы. */
export interface ComponentSFCTableCellInteractionsProjection {
  editable: boolean
  rules: ComponentSFCTableCellInteractionRuleProjection[]
  suffixes: ComponentSFCTableCellInteractionFlag[]
  sourceRange?: RComponentSFC_SourceRange
  message?: string
}

/** Source-backed локальная reaction одного semantic Event. */
export interface ComponentSFCEventReactionProjection {
  editable: boolean
  source: string | null
  suffixes: ComponentSFCTableCellInteractionFlag[]
  sourceRange?: RComponentSFC_SourceRange
  message?: string
}

export interface ComponentSFCEditOutcomeProjection {
  editable: boolean
  triggers: ComponentSFCInteractionTriggerProjection[]
  usesDefault: boolean
  suffixes: ComponentSFCTableCellInteractionFlag[]
  message?: string
}

export type ComponentSFCTableVisualCellSyntax = 'cell' | 'direct' | 'editable-default' | 'editable-edit'

export type ComponentSFCTableEditableElementProjection
  = | {
    kind: 'component'
    identity: string | null
    syntax: ComponentSFCTableVisualCellSyntax
    bindings: ComponentSFCTableCellBindingProjection[]
  }
  | {
    kind: 'tag'
    tag: ComponentSFCTableVisualCellTag
    syntax: ComponentSFCTableVisualCellSyntax
    bindings: ComponentSFCTableCellBindingProjection[]
  }
  | { kind: 'source' }

/** Source-backed editable-поведение единственного управляемого корня ячейки Table. */
export interface ComponentSFCTableCellEditingProjection {
  editable: boolean
  enabled: boolean
  mode: 'primitive' | 'custom' | 'component' | 'source' | 'unavailable'
  tag: string | null
  triggers: ComponentSFCInteractionTriggerProjection[]
  usesDefaultTrigger: boolean
  suffixes: ComponentSFCTableCellInteractionFlag[]
  reaction: ComponentSFCEventReactionProjection
  cancel: ComponentSFCEditOutcomeProjection
  commit: ComponentSFCEditOutcomeProjection
  editor: ComponentSFCTableEditableElementProjection | null
  editorImplicit: boolean
  sourceRange?: RComponentSFC_SourceRange
  message?: string
}

/** Способ, которым содержимое ячейки представлено в простом visual editor. */
export type ComponentSFCTableVisualCellTag = Exclude<
  RComponentSFC_IR_Tag,
  'Component' | 'Table' | 'Column' | 'Cell' | 'ColumnMenu' | 'CellMenu' | 'RowMenu' | 'MenuItem' | 'MenuSeparator' | 'Editable' | 'Variant'
>

export type ComponentSFCTableCellProjection
  = | { kind: 'default' }
    | {
      kind: 'component'
      identity: string | null
      syntax: ComponentSFCTableVisualCellSyntax
      bindings: ComponentSFCTableCellBindingProjection[]
    }
    | {
      kind: 'tag'
      tag: ComponentSFCTableVisualCellTag
      syntax: ComponentSFCTableVisualCellSyntax
      bindings: ComponentSFCTableCellBindingProjection[]
    }
    | { kind: 'source' }

/** Контекст реестра для разрешения прямых тегов пользовательских компонентов при чтении Source. */
export interface ComponentSFCVisualInspectionOptions {
  resolveComponentTag?: (tag: string) => string | null
  resolveTypeDefinition?: (identity: string) => TypeSourceDefinition | null
  /** Идентификаторы прямых Action, доступные bindings MenuItem из Source. */
  actionIdentities?: Iterable<string>
  /** Effective editing defaults текущего compiler context. */
  sfcEditing?: EndgeSFCEditingConfiguration
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
  editing: ComponentSFCTableCellEditingProjection
  interactions: ComponentSFCTableCellInteractionsProjection
  /** Переопределение CellMenu уровня Column; режим по умолчанию наследует Table > CellMenu. */
  cellMenu: ComponentSFCTableMenuProjection
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
    visible: ComponentSFCVisualSourceValue | null
    disabled: ComponentSFCVisualSourceValue | null
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
    name: 'ref' | 'selection-mode' | 'selection-trigger' | 'cell-selection-mode' | 'paging' | 'page-size' | 'page-sizes' | 'default-pin' | 'default-sort' | 'default-hidden'
    value: string | null
  }
  | {
    type: 'set-column-component'
    columnIndex: number
    identity: string | null
    syntax?: ComponentSFCTableVisualCellSyntax
  }
  | {
    type: 'set-column-tag'
    columnIndex: number
    tag: ComponentSFCTableVisualCellTag | null
    syntax?: ComponentSFCTableVisualCellSyntax
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
    /** Полное выражение объекта или массива либо null для удаления аннотации. */
    value: string | null
  }
  | {
    type: 'set-column-cell-editable'
    columnIndex: number
    enabled: boolean
  }
  | {
    type: 'set-column-cell-edit-triggers'
    columnIndex: number
    /** Пустой список восстанавливает неявный trigger клика и удаляет edit-on из Source. */
    triggers: ComponentSFCInteractionTriggerProjection[]
  }
  | {
    type: 'set-column-cell-edited-reaction'
    columnIndex: number
    /** Полное выражение локальной реакции либо null для удаления @edited. */
    value: string | null
  }
  | {
    type: 'set-column-cell-cancel-triggers'
    columnIndex: number
    /** Null наследует фактическую конфигурацию; пустой список явно отключает автоматическую отмену. */
    triggers: ComponentSFCInteractionTriggerProjection[] | null
  }
  | {
    type: 'set-column-cell-commit-triggers'
    columnIndex: number
    /** Null наследует фактическую конфигурацию; пустой список явно отключает автоматическое подтверждение. */
    triggers: ComponentSFCInteractionTriggerProjection[] | null
  }
  | {
    type: 'set-column-cell-editor-component'
    columnIndex: number
    identity: string
  }
  | {
    type: 'set-column-cell-editor-tag'
    columnIndex: number
    tag: ComponentSFCTableVisualCellTag
  }
  | {
    type: 'set-column-cell-editor-attribute'
    columnIndex: number
    name: string
    value: string | null
    valueKind: 'expression' | 'literal'
  }
  | {
    type: 'set-menu-mode'
    menu: ComponentSFCTableVisualMenuKind
    columnIndex?: number
    mode: 'default' | 'disabled' | 'none' | 'custom'
  }
  | {
    type: 'add-menu-node'
    menu: ComponentSFCTableVisualMenuKind
    columnIndex?: number
    node: 'item' | 'separator'
  }
  | {
    type: 'remove-menu-node'
    menu: ComponentSFCTableVisualMenuKind
    columnIndex?: number
    nodeIndex: number
  }
  | {
    type: 'move-menu-node'
    menu: ComponentSFCTableVisualMenuKind
    columnIndex?: number
    fromIndex: number
    toIndex: number
  }
  | {
    type: 'set-menu-item-attribute'
    menu: ComponentSFCTableVisualMenuKind
    columnIndex?: number
    nodeIndex: number
    name: 'label' | 'action' | 'input' | 'icon' | 'visible' | 'disabled'
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
  cellSelectionMode: ComponentSFCVisualSourceValue | null
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
