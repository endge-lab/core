import type { RComponentSFC_IR_Tag } from '@/features/core/modules/domain/types/component/sfc/ir.types'
import type { RuntimeHostInputSource } from '@/features/core/modules/runtime/domain/runtime-host.types'

// Идентификатор формата JSON UI: готовый снимок дерева SFC с вычисленными значениями.
export const ENDGE_UI_JSON_FORMAT = 'endge-ui/v1'

// Идентификатор renderer adapter-а JSON UI в реестре `Endge.uiRegistry.adapters`.
export const ENDGE_UI_JSON_ADAPTER_ID = 'endge-ui-json'

// Значение renderer-а JSON adapter-а в контракте `endge-sfc`.
export const ENDGE_UI_JSON_RENDERER = 'json'

export type EndgeUIJsonValue
  = | null
    | boolean
    | number
    | string
    | EndgeUIJsonValue[]
    | { [key: string]: EndgeUIJsonValue }

// Служебные типы узлов, которых нет среди тегов SFC: текст, строка и ячейка таблицы.
export type EndgeUISyntheticNodeType = '#text' | '#row' | '#cell'

export type EndgeUINodeType = RComponentSFC_IR_Tag | EndgeUISyntheticNodeType

// Маркер возможности, которую JSON-снимок не переносит или переносит частично.
export interface EndgeUIMarker {
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
}

// Состояние Editable или редактируемого primitive.
export interface EndgeUIEditableState {
  active: boolean
  value: EndgeUIJsonValue
  draft?: EndgeUIJsonValue
  // Нормализованные триггеры входа в редактирование (`:edit-on`); жест выбирает host.
  triggers: EndgeUIJsonValue[]
}

export interface EndgeUIMenuItem {
  kind: 'item'
  id: string
  label: string
  action: string
  icon?: string
  disabled?: boolean
}

export interface EndgeUIMenuSeparator {
  kind: 'separator'
  id: string
}

export interface EndgeUIMenu {
  items: Array<EndgeUIMenuItem | EndgeUIMenuSeparator>
}

export interface EndgeUITableColumn {
  key: string
  title: string
  width?: number
  align?: string
  sortable?: boolean
  menu?: EndgeUIMenu
}

// Схема колонок и окно строк Table. Строки — дочерние узлы `#row` → `#cell`.
export interface EndgeUITableState {
  rowKey: string
  columns: EndgeUITableColumn[]
  rowCount: number
  offset: number
  limit: number
}

// Узел JSON UI. `id` стабилен между снимками для того же логического элемента.
export interface EndgeUINode {
  id: string
  type: EndgeUINodeType
  // Вычисленные props узла (условия и циклы уже развёрнуты, функции и undefined отброшены).
  props: Record<string, EndgeUIJsonValue>
  children: EndgeUINode[]
  // Готовый к показу текст: interpolation, форматированные Number и DateTime.
  text?: string
  // События, которые host может передать через `dispatch(id, event, payload)`.
  events?: string[]
  // Классы, состояния и parts EndgeCSS из `class`, `state`, `part`.
  classes?: string[]
  states?: string[]
  parts?: string[]
  // Объявления EndgeCSS, применённые к узлу (`property → value`, значения как в Source).
  style?: Record<string, string>
  // Identity вложенного Component, развернутого внутри узла.
  component?: string
  editable?: EndgeUIEditableState
  table?: EndgeUITableState
  menu?: EndgeUIMenu
  markers?: EndgeUIMarker[]
}

// Полный снимок одного смонтированного компонента.
export interface EndgeUIJsonSnapshot {
  format: typeof ENDGE_UI_JSON_FORMAT
  revision: number
  component: string | null
  roots: EndgeUINode[]
  markers?: EndgeUIMarker[]
}

// Дочерний элемент операции `children`: новый узел целиком или ссылка на уже известный узел.
export type EndgeUIChildEntry = EndgeUINode | { ref: string }

// Поля узла, которые меняет операция `update`.
export type EndgeUINodeField = Exclude<keyof EndgeUINode, 'id' | 'type' | 'children'>

export type EndgeUIPatchOperation
  // Новые значения собственных полей узла; `unset` удаляет поля.
  = | { op: 'update', id: string, set?: Partial<Pick<EndgeUINode, EndgeUINodeField>>, unset?: EndgeUINodeField[] }
  // Новый порядок детей узла (`id: null` — корни снимка). Узлы, не перечисленные по ссылке, удалены.
    | { op: 'children', id: string | null, children: EndgeUIChildEntry[] }
  // Узел заменён целиком (сменился тип).
    | { op: 'replace', id: string, node: EndgeUINode }
  // Сменились маркеры снимка.
    | { op: 'markers', markers: EndgeUIMarker[] }

// Минимальный патч `endge-ui/v1`, переводящий снимок `baseRevision` в `revision`.
export interface EndgeUIPatch {
  format: typeof ENDGE_UI_JSON_FORMAT
  baseRevision: number
  revision: number
  ops: EndgeUIPatchOperation[]
}

export interface EndgeUIDispatchResult {
  handled: boolean
  reason?: 'unknown-node' | 'unknown-event' | 'unmounted'
}

export interface EndgeUIJsonMountOptions {
  // Источник входа host-а. Без него используется уже установленный Composition источник.
  input?: RuntimeHostInputSource
  // Locale форматирования Number/DateTime. По умолчанию — locale контекста Endge.
  locale?: string
  // Часовой пояс DateTime без явного `timezone`. По умолчанию — timezone контекста Endge.
  timezone?: string
  // Тема для правил EndgeCSS. По умолчанию — `Endge.ui.theme`.
  theme?: string
  // Окно строк Table по умолчанию (меняется событием `table.page`). По умолчанию 100.
  tableRowLimit?: number
  // `microtask` (по умолчанию) объединяет изменения в один патч, `sync` строит патч сразу.
  schedule?: 'microtask' | 'sync'
}

// Смонтированный JSON UI одного Component SFC runtime host-а.
export interface EndgeUIJsonMount {
  snapshot: () => EndgeUIJsonSnapshot
  subscribe: (listener: (patch: EndgeUIPatch) => void) => () => void
  dispatch: (nodeId: string, event: string, payload?: unknown) => Promise<EndgeUIDispatchResult>
  // Пересчитывает снимок немедленно и рассылает патч, если он не пуст.
  refresh: () => EndgeUIPatch | null
  unmount: () => void
}
