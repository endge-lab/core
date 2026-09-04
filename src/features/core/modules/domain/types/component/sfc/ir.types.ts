import type { RComponentDiagnostic } from '../component-core.types'
import type { RComponentSFC_SourceRange } from './location.types'
import type {
  ComponentSFCEventAction,
  ComponentSFCPortForwardOrigin,
  ComponentSFCPortManifest,
  ComponentSFCRequiredPortBinding,
  RComponentSFC_IR_ComponentPortMarker,
  RComponentSFC_IR_PortCall,
} from './ports.types'
import type { EndgeStyleSheetArtifact } from '@/features/core/modules/styles/domain/types/style.types'

/** Семантическая модель компонента после compiler pipeline, независимая от DOM и Nova. */
export interface RComponentSFC_IR {
  /** Версия IR-модели. */
  version: 1

  /** Нормализованная модель script setup. */
  script: RComponentSFC_IR_Script

  /** Нормализованный граф template-узлов: Text, Flex, Box, Component и другие primitives. */
  template: RComponentSFC_IR_Template

  /** Нормализованная модель endgecss-стилей. */
  style: RComponentSFC_IR_Style | null
}

/** IR script-секции после извлечения контракта и локальных bindings. */
export interface RComponentSFC_IR_Script {
  /** Входные props компонента. */
  props: RComponentSFC_IR_Prop[]

  /** Локальные bindings, доступные template-выражениям. */
  locals: RComponentSFC_IR_LocalBinding[]

  /** Объявления портов, разрешённые при компиляции. */
  ports: ComponentSFCPortManifest

  /** Вызовы портов computation верхнего уровня, инициализирующие локальные значения template. */
  portCalls: RComponentSFC_IR_PortCall[]
}

/** IR prop компонента. */
export interface RComponentSFC_IR_Prop {
  /** Имя prop. */
  name: string

  /** Доменный или TypeScript-тип prop в нормализованном виде. */
  type: string

  /** Флаг массива. */
  isArray?: boolean

  /** Флаг необязательного prop. */
  optional?: boolean

  /** Позиция исходного объявления prop. */
  sourceRange?: RComponentSFC_SourceRange
}

/** IR локальный binding script setup. */
export interface RComponentSFC_IR_LocalBinding {
  /** Имя binding. */
  name: string

  /** Тип binding, если compiler смог его определить. */
  type?: string

  /** Позиция исходного объявления binding. */
  sourceRange?: RComponentSFC_SourceRange
}

/** IR template-секции. */
export interface RComponentSFC_IR_Template {
  /** Корневые узлы нормализованного template. */
  roots: RComponentSFC_IR_Node[]

  /** Явные renderer-neutral варианты корневого представления. */
  variants?: ComponentSFCVariant[]
}

/** Один именованный вариант представления внутри template или Editable. */
export interface ComponentSFCVariant {
  name: string
  nodeId: string
}

/** Декларативный триггер входа в edit-вариант. */
export interface ComponentSFCInteractionTriggerModifiers {
  /** Физическая клавиша Control на любой платформе. */
  ctrl?: boolean
  /** Физическая клавиша Shift. */
  shift?: boolean
  /** Физическая клавиша Alt/Option. */
  alt?: boolean
  /** Физическая клавиша Meta: Command на macOS, Windows/Super на других платформах. */
  meta?: boolean
  /** Основной shortcut modifier: Command на macOS, Control на Windows/Linux. */
  mod?: boolean
  /** AltGraph, когда браузер предоставляет его через getModifierState(). */
  altGraph?: boolean
  /** Запрещает дополнительные физические ctrl/shift/alt/meta modifiers. */
  exact?: boolean
}

/** Обычные немодификаторные клавиши, удерживаемые во время trigger event. */
export interface ComponentSFCInteractionTriggerHeldKeys {
  /** Логические KeyboardEvent.key с учётом раскладки. */
  key?: string[]
  /** Физические KeyboardEvent.code без зависимости от раскладки. */
  code?: string[]
  /** all требует все перечисленные клавиши, any — хотя бы одну. */
  match?: 'all' | 'any'
  /** Запрещает другие удерживаемые обычные клавиши. */
  exact?: boolean
}

/** Условие на текущее состояние клавиатуры без привязки к конкретному событию. */
export interface ComponentSFCInteractionKeyboardCondition {
  modifiers?: ComponentSFCInteractionTriggerModifiers
  held?: ComponentSFCInteractionTriggerHeldKeys
}

export interface ComponentSFCInteractionTrigger extends ComponentSFCInteractionKeyboardCondition {
  event: string
  key?: string[]
  code?: string[]
  repeat?: boolean
  composing?: boolean
  button?: number
  stop?: boolean
  prevent?: boolean
  self?: boolean
  once?: boolean
  capture?: boolean
  passive?: boolean
}

export type ComponentSFCInteractionTriggerPlatform = 'macos' | 'windows' | 'linux' | 'unknown'

/** Renderer-neutral snapshot нативного события для проверки edit trigger. */
export interface ComponentSFCInteractionTriggerEvent {
  key?: string
  code?: string
  repeat?: boolean
  composing?: boolean
  button?: number
  targetIsCurrentTarget: boolean
  held?: {
    key: string[]
    code: string[]
  }
  modifiers: {
    ctrl: boolean
    shift: boolean
    alt: boolean
    meta: boolean
    altGraph: boolean
  }
}

/** Editable-имена общего контракта взаимодействия для обратной совместимости. */
export type ComponentSFCEditTriggerModifiers = ComponentSFCInteractionTriggerModifiers
export type ComponentSFCEditTriggerHeldKeys = ComponentSFCInteractionTriggerHeldKeys
export type ComponentSFCEditTrigger = ComponentSFCInteractionTrigger
export type ComponentSFCEditTriggerPlatform = ComponentSFCInteractionTriggerPlatform
export type ComponentSFCEditTriggerEvent = ComponentSFCInteractionTriggerEvent

/** Renderer-neutral поведение редактируемого template-узла. */
export interface ComponentSFCEditableBehavior {
  value: RComponentSFC_IR_Value
  triggers: RComponentSFC_IR_Value
  /** Triggers, отменяющие активный черновик. По умолчанию Escape и уход focus из Editable. */
  cancelTriggers: RComponentSFC_IR_Value
  /** Triggers, подтверждающие активный черновик. По умолчанию Enter. */
  commitTriggers: RComponentSFC_IR_Value
  /** Статические суффиксные модификаторы, объявленные в `:edit-on`. */
  modifiers?: RComponentSFC_IR_EventModifier[]
  cancelModifiers?: RComponentSFC_IR_EventModifier[]
  commitModifiers?: RComponentSFC_IR_EventModifier[]
}

/** Нормализованное публичное событие завершённого редактирования. */
export interface ComponentSFCEditedEventPayload<T = unknown> {
  value: T
  previousValue: T
}

/** IR узел template после нормализации в Endge primitives. */
export type RComponentSFC_IR_Node
  = RComponentSFC_IR_ElementNode
    | RComponentSFC_IR_TextNode
    | RComponentSFC_IR_ExpressionNode

/** Поддерживаемые v1 primitives нового SFC template. */
export type RComponentSFC_IR_Tag
  = 'Text'
    | 'DateTime'
    | 'Number'
    | 'Icon'
    | 'Badge'
    | 'Dot'
    | 'Box'
    | 'Flex'
    | 'Grid'
    | 'Divider'
    | 'Input'
    | 'Textarea'
    | 'Checkbox'
    | 'Select'
    | 'Tooltip'
    | 'TooltipTrigger'
    | 'TooltipContent'
    | 'Component'
    | 'Table'
    | 'Column'
    | 'Cell'
    | 'ColumnMenu'
    | 'CellMenu'
    | 'RowMenu'
    | 'MenuItem'
    | 'MenuSeparator'
    | 'Editable'
    | 'Variant'

/** IR element-узел, который renderer-слои могут читать без знания исходного синтаксиса. */
export interface RComponentSFC_IR_ElementNode {
  /** Стабильный id узла внутри IR. */
  id: string

  /** Тип IR-узла. */
  kind: 'element'

  /** Нормализованный Endge primitive tag. */
  tag: RComponentSFC_IR_Tag

  /** Исходный публичный тег компонента до нормализации в Component. */
  componentTag?: string

  /** Нормализованные props элемента. */
  props: Record<string, RComponentSFC_IR_Value>

  /** Нормализованные control-flow директивы элемента. */
  directives: RComponentSFC_IR_Directives

  /** Локальные реакции renderer на Event, объявленные через атрибуты `@event`. */
  events?: RComponentSFC_IR_EventBinding[]

  /** Условные локальные реакции, объявленные через нейтральную к renderer аннотацию `:on`. */
  interactions?: RComponentSFC_IR_InteractionGroup[]

  /** Compiler-owned edit behavior; editable/edit-on не передаются visual adapter-у как props. */
  editable?: ComponentSFCEditableBehavior

  /** Дочерние IR-узлы. */
  children: RComponentSFC_IR_Node[]

  /** Маркер порта локального компонента, сохранённый для будущих переопределений провайдера. */
  port?: RComponentSFC_IR_ComponentPortMarker

  /** Статические bindings экземпляра для обязательных портов дочернего компонента. */
  portBindings?: ComponentSFCRequiredPortBinding[]

  /** Разрешённые компилятором меню Table, включая перенаправленные идентификаторы и цели Action. */
  tableMenus?: RComponentSFC_IR_TableMenus

  /** Разрешённое компилятором переопределение CellMenu для одной Column. */
  cellMenu?: ComponentSFCTableCellMenuDescriptor

  /** Позиция исходного AST-узла. */
  sourceRange?: RComponentSFC_SourceRange
}

export interface RComponentSFC_IR_TableMenus {
  column: ComponentSFCTableColumnMenuDescriptor
  /** Меню ячейки данных по умолчанию. `row` сохранено как имя поля совместимости. */
  row: ComponentSFCTableCellMenuDescriptor
}

export type ComponentSFCTableColumnMenuMode = 'default' | 'disabled' | 'inline'
export type ComponentSFCTableRowMenuMode = 'none' | 'inline'
export type ComponentSFCTableCellMenuMode = 'none' | 'inline'

/** Нейтральное к renderer меню в скомпилированной форме SFC до появления контекста конкретной строки и колонки. */
export interface ComponentSFCTableMenuDescriptor {
  kind: 'sfc-table-menu'
  items: ComponentSFCTableMenuNodeDescriptor[]
}

export type ComponentSFCTableMenuNodeDescriptor
  = | ComponentSFCTableMenuItemDescriptor
    | ComponentSFCTableMenuSeparatorDescriptor

export interface ComponentSFCTableMenuItemDescriptor {
  kind: 'item'
  id: string
  label: RComponentSFC_IR_Value
  /** Выражение `v-if`, вычисляемое в контексте конкретной таблицы и ячейки. */
  visible?: RComponentSFC_IR_Value
  /** Статическое или динамическое состояние disabled, вычисляемое в том же контексте, что и Action. */
  disabled?: RComponentSFC_IR_Value
  action: string
  /** Обязательный порт Action, смонтированный провайдер которого может заменить `action`. */
  requiredPort?: string
  input?: RComponentSFC_IR_Value
  icon?: string
  /** Задаётся только для предоставленного alias, перенаправленного из этого конкретного узла Table. */
  forwardedFrom?: ComponentSFCPortForwardOrigin
}

export interface ComponentSFCTableMenuSeparatorDescriptor {
  kind: 'separator'
  id: string
}

export interface ComponentSFCTableColumnMenuDescriptor {
  mode: ComponentSFCTableColumnMenuMode
  menu: ComponentSFCTableMenuDescriptor | null
  diagnostics: RComponentDiagnostic[]
}

export interface ComponentSFCTableRowMenuDescriptor {
  mode: ComponentSFCTableRowMenuMode
  menu: ComponentSFCTableMenuDescriptor | null
  diagnostics: RComponentDiagnostic[]
}

/** Канонический описатель меню ячейки. RowMenu использует ту же форму как legacy alias. */
export type ComponentSFCTableCellMenuDescriptor = ComponentSFCTableRowMenuDescriptor

export type RComponentSFC_IR_EventModifier
  = 'stop' | 'prevent' | 'self' | 'once' | 'capture' | 'passive'

export interface RComponentSFC_IR_EventBinding {
  name: string
  modifiers: RComponentSFC_IR_EventModifier[]
  action: ComponentSFCEventAction
  /** Упорядоченные реакции. `action` остаётся представлением первого элемента для совместимости. */
  actions?: ComponentSFCEventAction[]
  sourceRange?: RComponentSFC_SourceRange
}

export interface RComponentSFC_IR_InteractionRule {
  /** Статическое имя события, необходимое для установки listener адаптера. */
  event: string
  /** Вычисляемый в runtime описатель trigger без `reaction`. */
  trigger: RComponentSFC_IR_Value
  /** Суффиксные модификаторы, применяемые к правилу после вычисления `trigger`. */
  modifiers: RComponentSFC_IR_EventModifier[]
  /** Параметры listener, известные при компиляции. */
  listener: { capture: boolean, passive: boolean }
  /** Реакции, последовательно выполняемые в порядке Source. */
  reactions: ComponentSFCEventAction[]
  sourceRange?: RComponentSFC_SourceRange
}

/** Один TriggerSet по ссылке вместе с реакциями, стабильными между слоями контекста. */
export interface RComponentSFC_IR_InteractionTriggerSet {
  triggers: RComponentSFC_IR_Value
  /** Имена Event, поддерживаемые скомпилированной поверхностью событий исходного тега. */
  events: string[]
  modifiers: RComponentSFC_IR_EventModifier[]
  reactions: ComponentSFCEventAction[]
  sourceRange?: RComponentSFC_SourceRange
}

/** Одна аннотация `:on`. Правила группы используют семантику первого совпадения. */
export interface RComponentSFC_IR_InteractionGroup {
  rules: RComponentSFC_IR_InteractionRule[]
  /** Необязательная форма TriggerSet `{ triggers, reaction }`, основанная на контексте. */
  triggerSet?: RComponentSFC_IR_InteractionTriggerSet
  sourceRange?: RComponentSFC_SourceRange
}

/** IR текстовый узел. */
export interface RComponentSFC_IR_TextNode {
  /** Стабильный id узла внутри IR. */
  id: string

  /** Тип IR-узла. */
  kind: 'text'

  /** Текстовое содержимое. */
  value: string

  /** Позиция исходного AST-узла. */
  sourceRange?: RComponentSFC_SourceRange
}

/** IR expression-узел, обычно полученный из interpolation. */
export interface RComponentSFC_IR_ExpressionNode {
  /** Стабильный id узла внутри IR. */
  id: string

  /** Тип IR-узла. */
  kind: 'expression'

  /** Нормализованное выражение. */
  value: RComponentSFC_IR_Value

  /** Позиция исходного AST-узла. */
  sourceRange?: RComponentSFC_SourceRange
}

/** Нормализованное значение prop/directive/text expression. */
export type RComponentSFC_IR_Value
  = RComponentSFC_IR_LiteralValue
    | RComponentSFC_IR_ExpressionValue

/** Literal-значение без runtime-вычисления. */
export interface RComponentSFC_IR_LiteralValue {
  /** Тип значения. */
  kind: 'literal'

  /** Непосредственное значение. */
  value: unknown
}

/** Runtime-выражение с зависимостями для реактивного обновления. */
export interface RComponentSFC_IR_ExpressionValue {
  /** Тип значения. */
  kind: 'expression'

  /** Исходный текст выражения. */
  source: string

  /** Зависимости, которые выражение читает. */
  reads: RComponentSFC_IR_Read[]

  /** Статические обращения к Vocab aliases текущего Composition scope. */
  vocabReads?: RComponentSFC_IR_VocabRead[]
}

/** Статическое обращение `vocab(alias, mapping?)` внутри SFC expression. */
export interface RComponentSFC_IR_VocabRead {
  /** Публичный alias из ближайшего Composition scope. */
  alias: string

  /** Путь option value внутри элемента Vocab. */
  valuePath: string

  /** Путь option label внутри элемента Vocab. */
  labelPath: string

  /** Исходное выражение для diagnostics/debug. */
  raw: string
}

/** Реактивное чтение, найденное внутри выражения. */
export interface RComponentSFC_IR_Read {
  /** Источник чтения: props, Raph/store, context или локальный binding. */
  source: 'props' | 'raph' | 'context' | 'local'

  /** Нормализованный путь чтения. */
  path: string[]

  /** Исходный текст чтения. */
  raw: string
}

/** Нормализованные control-flow директивы IR element-узла. */
export interface RComponentSFC_IR_Directives {
  /** Условие отображения узла. */
  if?: RComponentSFC_IR_Value

  /** Условие отображения else-if узла. */
  elseIf?: RComponentSFC_IR_Value

  /** Флаг else ветки. */
  else?: boolean

  /** Описание цикла for. */
  for?: RComponentSFC_IR_ForDirective

  /** Значение key для повторяемых узлов. */
  key?: RComponentSFC_IR_Value
}

/** Нормализованная for-директива. */
export interface RComponentSFC_IR_ForDirective {
  /** Имя переменной элемента коллекции. */
  item: string

  /** Имя переменной индекса, если она указана. */
  index?: string

  /** Источник коллекции. */
  source: RComponentSFC_IR_Value
}

/** IR style-секции после нормализации endgecss. */
export type RComponentSFC_IR_Style = EndgeStyleSheetArtifact
