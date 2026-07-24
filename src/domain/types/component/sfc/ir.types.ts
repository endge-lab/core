import type { RComponentSFC_SourceRange } from './location.types'
import type {
  ComponentSFCEventAction,
  ComponentSFCPortManifest,
  RComponentSFC_IR_ComponentPortMarker,
  RComponentSFC_IR_PortCall,
} from './ports.types'
import type { EndgeStyleSheetArtifact } from '@/domain/types/style'

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

  /** Port declarations resolved during compilation. */
  ports: ComponentSFCPortManifest

  /** Top-level computation port calls that initialize template locals. */
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
    | 'Component'
    | 'Table'
    | 'Column'
    | 'Cell'
    | 'ColumnMenu'
    | 'MenuItem'
    | 'MenuSeparator'

/** IR element-узел, который renderer-слои могут читать без знания исходного синтаксиса. */
export interface RComponentSFC_IR_ElementNode {
  /** Стабильный id узла внутри IR. */
  id: string

  /** Тип IR-узла. */
  kind: 'element'

  /** Нормализованный Endge primitive tag. */
  tag: RComponentSFC_IR_Tag

  /** Original public component tag before normalization to Component. */
  componentTag?: string

  /** Нормализованные props элемента. */
  props: Record<string, RComponentSFC_IR_Value>

  /** Нормализованные control-flow директивы элемента. */
  directives: RComponentSFC_IR_Directives

  /** Local renderer Event reactions declared through `@event` attributes. */
  events?: RComponentSFC_IR_EventBinding[]

  /** Дочерние IR-узлы. */
  children: RComponentSFC_IR_Node[]

  /** Local component port marker retained for future provider overrides. */
  port?: RComponentSFC_IR_ComponentPortMarker

  /** Позиция исходного AST-узла. */
  sourceRange?: RComponentSFC_SourceRange
}

export type RComponentSFC_IR_EventModifier
  = 'stop' | 'prevent' | 'self' | 'once' | 'capture' | 'passive'

export interface RComponentSFC_IR_EventBinding {
  name: string
  modifiers: RComponentSFC_IR_EventModifier[]
  action: ComponentSFCEventAction
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
  /** Источник чтения: props, Raph/store или локальный binding. */
  source: 'props' | 'raph' | 'local'

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
