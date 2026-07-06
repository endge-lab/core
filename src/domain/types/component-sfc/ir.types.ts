import type { RComponentSFC_SourceRange } from './location.types'

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
    | 'Divider'
    | 'Component'

/** IR element-узел, который renderer-слои могут читать без знания исходного синтаксиса. */
export interface RComponentSFC_IR_ElementNode {
  /** Стабильный id узла внутри IR. */
  id: string

  /** Тип IR-узла. */
  kind: 'element'

  /** Нормализованный Endge primitive tag. */
  tag: RComponentSFC_IR_Tag

  /** Нормализованные props элемента. */
  props: Record<string, RComponentSFC_IR_Value>

  /** Нормализованные control-flow директивы элемента. */
  directives: RComponentSFC_IR_Directives

  /** Дочерние IR-узлы. */
  children: RComponentSFC_IR_Node[]

  /** Позиция исходного AST-узла. */
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
export interface RComponentSFC_IR_Style {
  /** Флаг scoped-стилей. */
  scoped: boolean

  /** Нормализованные style rules. */
  rules: RComponentSFC_IR_StyleRule[]

  /** Исходный style-текст, пока endgecss compiler не нормализует все rules. */
  content: string
}

/** Нормализованное style-правило. */
export interface RComponentSFC_IR_StyleRule {
  /** Selector правила в renderer-neutral форме. */
  selector: string

  /** CSS/endgecss declarations правила. */
  declarations: Record<string, RComponentSFC_IR_Value>

  /** Позиция исходного style-правила. */
  sourceRange?: RComponentSFC_SourceRange
}
