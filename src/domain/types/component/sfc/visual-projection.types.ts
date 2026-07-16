import type { RComponentDiagnostic } from '@/domain/types/component/component-core.types'
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

/** Способ, которым содержимое ячейки представлено в простом visual editor. */
export type ComponentSFCTableCellProjection
  = | { kind: 'default' }
    | { kind: 'component', identity: string | null }
    | { kind: 'source' }

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
  hasCustomCell: boolean
  cellSource: string | null
  sourceRange: RComponentSFC_SourceRange
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
      name: 'key' | 'title' | 'width'
      value: string | null
    }
    | {
      type: 'set-column-component'
      columnIndex: number
      identity: string | null
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
  rows: ComponentSFCVisualSourceValue | null
  rowKey: ComponentSFCVisualSourceValue | null
  sortMode: ComponentSFCVisualSourceValue | null
  defaultSort: ComponentSFCVisualSourceValue | null
  columnPin: ComponentSFCVisualSourceValue | null
  defaultPin: ComponentSFCVisualSourceValue | null
  columnMenu: ComponentSFCVisualSourceValue | null
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
