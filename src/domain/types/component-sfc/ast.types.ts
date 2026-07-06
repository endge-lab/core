import type { RComponentSFC_SourceRange } from './location.types'

/** Parser-level AST SFC source до построения семантического IR. */
export interface RComponentSFC_AST {
  /** Версия AST-модели. */
  version: 1

  /** Разобранная script-секция. */
  script: RComponentSFC_AST_Script | null

  /** Разобранная template-секция. */
  template: RComponentSFC_AST_Template | null

  /** Разобранная style-секция. */
  style: RComponentSFC_AST_Style | null
}

/** AST script setup секции. */
export interface RComponentSFC_AST_Script {
  /** Язык script-секции: ts, js или другое значение из source. */
  lang: string | null

  /** Флаг script setup. Для Endge SFC v1 ожидается true. */
  setup: boolean

  /** Полный текст script-секции без внешнего тега. */
  content: string

  /** Синтаксическое объявление defineProps, если оно найдено. */
  props: RComponentSFC_AST_PropsDeclaration | null

  /** Preview-only значения props для песочницы, если найден definePreviewProps. */
  previewProps: RComponentSFC_AST_PreviewPropsDeclaration | null

  /** Верхнеуровневые bindings, найденные в script. */
  bindings: RComponentSFC_AST_ScriptBinding[]

  /** Позиция script-секции в полном source. */
  range: RComponentSFC_SourceRange
}

/** AST объявления defineProps. */
export interface RComponentSFC_AST_PropsDeclaration {
  /** Исходный текст generic-типа или runtime-объекта props. */
  source: string

  /** Формат объявления props. */
  mode: 'type' | 'runtime'

  /** Позиция объявления defineProps в полном source. */
  range: RComponentSFC_SourceRange
}

/** AST объявления definePreviewProps. */
export interface RComponentSFC_AST_PreviewPropsDeclaration {
  /** Исходный текст object literal, переданный в definePreviewProps. */
  source: string

  /** Позиция объявления definePreviewProps в полном source. */
  range: RComponentSFC_SourceRange
}

/** AST binding из script setup. */
export interface RComponentSFC_AST_ScriptBinding {
  /** Имя binding, доступное template-компилятору. */
  name: string

  /** Синтаксический тип binding. */
  kind: 'prop' | 'const' | 'let' | 'function' | 'import' | 'store' | 'unknown'

  /** Позиция binding в полном source. */
  range: RComponentSFC_SourceRange
}

/** AST template секции. */
export interface RComponentSFC_AST_Template {
  /** Корневые узлы template. */
  roots: RComponentSFC_AST_TemplateNode[]

  /** Позиция template-секции в полном source. */
  range: RComponentSFC_SourceRange
}

/** AST узел template до семантической нормализации. */
export type RComponentSFC_AST_TemplateNode
  = RComponentSFC_AST_ElementNode
    | RComponentSFC_AST_TextNode
    | RComponentSFC_AST_InterpolationNode

/** AST element-узел template. */
export interface RComponentSFC_AST_ElementNode {
  /** Тип AST-узла. */
  kind: 'element'

  /** Имя тега ровно в том виде, как оно написано в template. */
  tag: string

  /** Статические и динамические атрибуты элемента. */
  attributes: RComponentSFC_AST_Attribute[]

  /** Директивы элемента: if, else-if, else, for, key и другие будущие расширения. */
  directives: RComponentSFC_AST_Directive[]

  /** Дочерние узлы элемента. */
  children: RComponentSFC_AST_TemplateNode[]

  /** Флаг self-closing записи. */
  selfClosing: boolean

  /** Позиция узла в полном source. */
  range: RComponentSFC_SourceRange
}

/** AST текстовый узел template. */
export interface RComponentSFC_AST_TextNode {
  /** Тип AST-узла. */
  kind: 'text'

  /** Текстовое содержимое узла. */
  content: string

  /** Позиция узла в полном source. */
  range: RComponentSFC_SourceRange
}

/** AST interpolation-узел template. */
export interface RComponentSFC_AST_InterpolationNode {
  /** Тип AST-узла. */
  kind: 'interpolation'

  /** Выражение внутри {{ ... }}. */
  expression: string

  /** Позиция узла в полном source. */
  range: RComponentSFC_SourceRange
}

/** AST атрибут template-элемента. */
export interface RComponentSFC_AST_Attribute {
  /** Имя атрибута без синтаксического префикса. */
  name: string

  /** Значение атрибута, если оно указано. */
  value: string | null

  /** Флаг динамического binding через :name. */
  dynamic: boolean

  /** Позиция атрибута в полном source. */
  range: RComponentSFC_SourceRange
}

/** AST директива template-элемента. */
export interface RComponentSFC_AST_Directive {
  /** Имя директивы без v-prefix: if, else-if, else, for, key, bind, on. */
  name: string

  /** Аргумент директивы, если синтаксис его поддерживает. */
  argument?: string

  /** Выражение директивы, если оно есть. */
  expression?: string

  /** Позиция директивы в полном source. */
  range: RComponentSFC_SourceRange
}

/** AST style секции. */
export interface RComponentSFC_AST_Style {
  /** Язык style-секции: endgecss или другое значение из source. */
  lang: string | null

  /** Флаг scoped-стилей. */
  scoped: boolean

  /** Полный текст style-секции без внешнего тега. */
  content: string

  /** Позиция style-секции в полном source. */
  range: RComponentSFC_SourceRange
}
