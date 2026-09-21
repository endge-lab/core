import type { RComponentSFC_IR_Tag } from './ir.types'

/** Статическое значение атрибута, которое можно безопасно предлагать в Source Editor. */
export type ComponentSFCTagAttributeLiteral = string | number | boolean

/** Renderer-neutral контракт атрибута встроенного SFC tag с конечным набором значений. */
export interface ComponentSFCTagAttributeContract {
  /** Каноническое имя для нового source. */
  name: string

  /** Совместимые имена, которые уже принимает compiler/runtime. */
  aliases?: readonly string[]

  /** Полный набор допустимых статических значений. */
  values: readonly ComponentSFCTagAttributeLiteral[]

  /** Значение, которое применяется при отсутствии атрибута. */
  defaultValue?: ComponentSFCTagAttributeLiteral

  /** Краткое описание для completion и hover. */
  description: string

  /** false, когда более контекстная проверка уже выполняется compiler-ом. */
  validate?: boolean
}

/** Дополнительные контракты tag, например literal-union props пользовательского компонента. */
export interface ComponentSFCAttributeAnalysisOptions {
  resolveTagAttributeContracts?: (
    tag: string,
  ) => readonly ComponentSFCTagAttributeContract[] | null | undefined
}

export const ENDGE_SFC_TABLE_SELECTION_MODES = ['none', 'single', 'multiple'] as const
export const ENDGE_SFC_TABLE_CELL_SELECTION_MODES = ['none', 'single'] as const
export const ENDGE_SFC_TABLE_SELECTION_TRIGGERS = ['auto', 'control', 'row', 'both'] as const
export const ENDGE_SFC_TABLE_PAGING_MODES = ['pages', 'virtual'] as const
export const ENDGE_SFC_TABLE_SORT_MODES = ['multiple', 'single', 'fixed', 'disabled'] as const
export const ENDGE_SFC_TABLE_SORT_COMPARATORS = ['natural', 'text', 'number', 'date', 'time', 'boolean'] as const
export const ENDGE_SFC_TABLE_COLUMN_PIN_MODES = ['enabled', 'disabled'] as const
export const ENDGE_SFC_TABLE_COLUMN_MENU_MODES = ['default', 'disabled'] as const
export const ENDGE_SFC_TABLE_CELL_ALIGNMENTS = ['left', 'center', 'right'] as const
export const ENDGE_SFC_TABLE_CELL_VERTICAL_ALIGNMENTS = ['top', 'middle', 'bottom'] as const
export const ENDGE_SFC_GRID_AUTO_FLOWS = ['row', 'column', 'row dense', 'column dense'] as const
export const ENDGE_SFC_GRID_ALIGNMENTS = ['start', 'center', 'end', 'stretch'] as const
export const ENDGE_SFC_FLEX_DIRECTIONS = ['row', 'column'] as const
export const ENDGE_SFC_DIVIDER_ORIENTATIONS = ['horizontal', 'vertical'] as const
export const ENDGE_SFC_INPUT_TYPES = ['String', 'Number', 'Date', 'Time', 'DateTime'] as const
export const ENDGE_SFC_TOOLTIP_SIDES = ['top', 'right', 'bottom', 'left'] as const
export const ENDGE_SFC_TOOLTIP_ALIGNS = ['start', 'center', 'end'] as const

/** Конечные значения встроенных SFC tags. Свободные string/number props сюда не входят. */
export const ENDGE_SFC_TAG_ATTRIBUTE_CONTRACTS = {
  Table: [
    {
      name: 'selection-mode',
      aliases: ['selectionMode'],
      values: ENDGE_SFC_TABLE_SELECTION_MODES,
      defaultValue: 'none',
      description: 'Допустимое количество выбранных строк.',
    },
    {
      name: 'selection-trigger',
      aliases: ['selectionTrigger'],
      values: ENDGE_SFC_TABLE_SELECTION_TRIGGERS,
      defaultValue: 'auto',
      description: 'Действие, которое меняет состояние выбора строки.',
    },
    {
      name: 'cell-selection-mode',
      aliases: ['cellSelectionMode'],
      values: ENDGE_SFC_TABLE_CELL_SELECTION_MODES,
      defaultValue: 'none',
      description: 'Режим выбора одной конкретной ячейки, независимый от выбора строк.',
    },
    {
      name: 'paging',
      values: ENDGE_SFC_TABLE_PAGING_MODES,
      defaultValue: 'pages',
      description: 'Страничное или виртуализированное отображение строк.',
    },
    {
      name: 'sort-mode',
      aliases: ['sortMode'],
      values: ENDGE_SFC_TABLE_SORT_MODES,
      defaultValue: 'multiple',
      description: 'Режим пользовательской сортировки Table.',
      validate: false,
    },
    {
      name: 'column-pin',
      aliases: ['columnPin'],
      values: ENDGE_SFC_TABLE_COLUMN_PIN_MODES,
      defaultValue: 'enabled',
      description: 'Разрешает или запрещает runtime-закрепление колонок.',
      validate: false,
    },
    {
      name: 'column-menu',
      aliases: ['columnMenu'],
      values: ENDGE_SFC_TABLE_COLUMN_MENU_MODES,
      defaultValue: 'default',
      description: 'Стандартное или отключённое меню заголовка колонки.',
      validate: false,
    },
    {
      name: 'cell-align',
      aliases: ['cellAlign'],
      values: ENDGE_SFC_TABLE_CELL_ALIGNMENTS,
      defaultValue: 'left',
      description: 'Горизонтальное выравнивание содержимого ячеек.',
    },
    {
      name: 'cell-vertical-align',
      aliases: ['cellVerticalAlign'],
      values: ENDGE_SFC_TABLE_CELL_VERTICAL_ALIGNMENTS,
      defaultValue: 'middle',
      description: 'Вертикальное выравнивание содержимого ячеек.',
    },
  ],
  Column: [
    {
      name: 'sort',
      values: ENDGE_SFC_TABLE_SORT_COMPARATORS,
      defaultValue: 'natural',
      description: 'Comparator для значений колонки.',
      validate: false,
    },
  ],
  Grid: [
    {
      name: 'autoFlow',
      values: ENDGE_SFC_GRID_AUTO_FLOWS,
      defaultValue: 'row',
      description: 'Направление автоматического размещения CSS Grid.',
    },
    {
      name: 'align',
      values: ENDGE_SFC_GRID_ALIGNMENTS,
      defaultValue: 'stretch',
      description: 'Выравнивание элементов по вертикальной оси Grid.',
    },
    {
      name: 'justify',
      values: ENDGE_SFC_GRID_ALIGNMENTS,
      defaultValue: 'stretch',
      description: 'Выравнивание элементов по горизонтальной оси Grid.',
    },
  ],
  Flex: [
    {
      name: 'direction',
      values: ENDGE_SFC_FLEX_DIRECTIONS,
      defaultValue: 'row',
      description: 'Направление основной оси Flex.',
    },
  ],
  Divider: [
    {
      name: 'orientation',
      values: ENDGE_SFC_DIVIDER_ORIENTATIONS,
      defaultValue: 'horizontal',
      description: 'Ориентация разделителя.',
    },
  ],
  Input: [
    {
      name: 'type',
      values: ENDGE_SFC_INPUT_TYPES,
      defaultValue: 'String',
      description: 'Семантический тип значения Input.',
    },
  ],
  Tooltip: [
    {
      name: 'side',
      values: ENDGE_SFC_TOOLTIP_SIDES,
      description: 'Предпочтительная сторона; adapter может перевернуть её при collision с viewport.',
    },
    {
      name: 'align',
      values: ENDGE_SFC_TOOLTIP_ALIGNS,
      description: 'Выравнивание tooltip относительно trigger.',
    },
  ],
} as const satisfies Partial<Record<RComponentSFC_IR_Tag, readonly ComponentSFCTagAttributeContract[]>>

/** Возвращает строгие контракты атрибутов одного встроенного SFC tag. */
export function getComponentSFCTagAttributeContracts(
  tag: string,
): readonly ComponentSFCTagAttributeContract[] {
  return ENDGE_SFC_TAG_ATTRIBUTE_CONTRACTS[
    tag as keyof typeof ENDGE_SFC_TAG_ATTRIBUTE_CONTRACTS
  ] ?? []
}

/** Находит строгий контракт по каноническому или совместимому имени атрибута. */
export function getComponentSFCTagAttributeContract(
  tag: string,
  attributeName: string,
): ComponentSFCTagAttributeContract | null {
  return getComponentSFCTagAttributeContracts(tag).find(contract => (
    contract.name === attributeName || contract.aliases?.includes(attributeName)
  )) ?? null
}
