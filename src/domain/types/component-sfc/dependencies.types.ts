import type { RComponentSFC_IR_Read } from './ir.types'

/** Источник runtime-зависимости SFC v1. */
export type RComponentSFC_RuntimeDependencySource = 'props'

/** Runtime-зависимость SFC template от входного prop. */
export interface RComponentSFC_RuntimeDependency {
  /** Источник зависимости. В v1 поддерживаем только props. */
  source: RComponentSFC_RuntimeDependencySource

  /** Имя входного prop, например `flight`. */
  prop: string

  /** Путь внутри prop, например `['status']` для `flight.status`. */
  path: string[]

  /** Исходный read из IR, полезен для diagnostics/debug. */
  raw: string

  /** Нормализованный read из IR. */
  read: RComponentSFC_IR_Read
}

/** Набор runtime-зависимостей SFC artifact. */
export interface RComponentSFC_RuntimeDependencies {
  /** Зависимости от props, которые можно связать с внешним input source. */
  props: RComponentSFC_RuntimeDependency[]
}

/** Создает пустой dependency artifact SFC runtime. */
export function createEmptyComponentSFCRuntimeDependencies(): RComponentSFC_RuntimeDependencies {
  return {
    props: [],
  }
}
