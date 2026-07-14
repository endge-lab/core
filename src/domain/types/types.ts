import type { RComponentBase } from '@/domain/entities/reflect/RComponentBase'
import type { RuntimeScope } from '@/domain/entities/runtime/RuntimeScope'
import type { ElementNode } from '@vue/compiler-dom'
import type { VNode } from 'vue'

import {RComponent} from "@/domain/types/component.types";

export enum RenderComponentType {
  Functional = 'functional', // функциональный компонент
  Component = 'component', // компонент Vue/React/Angular/Svelte
}

export interface RenderComponentInfo {
  type: RenderComponentType // тип рендер-компонента
  component: any // сам рендер-компонент
}

/**
 * Описывает UI оформление данных
 */
export enum Prefix {
  // Класс для контейнера обертки любого компонента
  ComponentWrapper = 'endge-component',

  // Атрибут для указания текста тултипа
  TooltipAttributeText = 'endge-tooltip-text',

  // Атрибут для указания компонента тултипа
  // совпадает с @utils/tooltip/types/TooltipAttribute (интеграция)
  TooltipAttributeId = 'endge-tooltip-id',
}

/**
 * Props для рендер-компонента
 */
export interface ComponentType_Props<T extends RComponentBase> {
  model: T
  comData: Record<string, any> // данные, которые требует компонент
  scope?: RuntimeScope
  context?: Record<string, any> // дополнительный контекст, который может быть передан в компонент
}

/**
 * Входной тип для рендер-компонента (в частности h-функций)
 */
export type ComponentRendererInput = ComponentType_Props<RComponent>

/**
 * Props для компонента JSX
 */
export interface JSXComponentProps {
  node: ElementNode
  children: (VNode | string | null)[]

  scope?: RuntimeScope
  handlers?: Record<string, CallableFunction>

  comData: Record<string, any> // данные только для компонента (извлеченные)

  styles?: Record<string, string>
}

/**
 * Входные данные для middleware-функции
 */
export interface JSXRenderMiddlewareInput {
  h: any
  props: JSXComponentProps
  node: ElementNode
  vnode: VNode | null
}

/**
 * Модель для описания того, как извлекаются данные под некоторый входной тип
 */
export interface AccessorDescriptor {
  name: string
  accessor: string
  converter?: string
}

// Разновидности компонентов (внутреннее свойство)
export enum ComponentKind {
  JSX = 'jsx', // компонент на JSX синтаксисе
  Vue = 'vue', // компонент на Vue синтаксисе
}

/**
 * Представление узла GraphQL-запроса.
 */
export interface GQLQueryNode {
  field: string
  children?: GQLQueryNode[]
  args?: Record<string, any>
}

/**
 * Параметры панели тестирования.
 */
export interface EndgeTestingOptions {
  // Количество элементов для генерации в ответе запроса
  // (Только, если у запроса установлен генератор)
  generatorCount?: number

  //
  // Количество обновлений в секунду.
  // Аналог SSE потока для тестирования.
  updatesPerSeconds?: number

  //
  // Настройки для генерации обновлений
  updatesOptions?: {
    paths: Set<string>
    vars: Record<string, any>
  }
}

export interface EndgeGlobalVar {
  name: string
  defaultValue: any
  currentValue: any
}

/**
 * Одна вкладка проекта в верхней панели.
 */
export interface ProjectTab {
  /** Уникальный идентификатор проекта / вкладки. */
  id: string
  /** Отображаемое имя проекта. */
  name: string
}
