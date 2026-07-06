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

/** Тип patchable runtime boundary внутри SFC IR. */
export type RComponentSFC_RuntimeBoundaryKind = 'table'

/** Runtime-зависимость колонки таблицы от полей текущей строки. */
export interface RComponentSFC_RuntimeTableColumnDependency {
  /** Стабильный boundary-id колонки, совпадает с id IR node. */
  id: string

  /** Ключ колонки из `<Column key="...">`. */
  key: string

  /** Видимый индекс колонки внутри таблицы. */
  index: number

  /** Поля alias-а `row`, которые читает cell template. */
  rowReads: string[]
}

/** Patchable runtime boundary SFC, для которой создается отдельная Raph-нода. */
export interface RComponentSFC_RuntimeBoundaryDependency {
  /** Стабильный boundary-id, совпадает с id IR node. */
  id: string

  /** Тип boundary. В v1 поддерживаем Table. */
  kind: RComponentSFC_RuntimeBoundaryKind

  /** Имя prop, из которого boundary получает коллекцию. */
  sourceProp: string

  /** Путь внутри prop, если source выражен как `foo.bar`. */
  sourcePath: string[]

  /** Поле ключа строки из `row-key`. */
  rowKey: string | null

  /** Колонки таблицы, которые можно обновлять точечно. */
  columns: RComponentSFC_RuntimeTableColumnDependency[]
}

/** Набор runtime-зависимостей SFC artifact. */
export interface RComponentSFC_RuntimeDependencies {
  /** Зависимости от props, которые можно связать с внешним input source. */
  props: RComponentSFC_RuntimeDependency[]

  /** Patchable boundaries, для которых runtime строит отдельные Raph-ноды. */
  boundaries: RComponentSFC_RuntimeBoundaryDependency[]
}

/** Создает пустой dependency artifact SFC runtime. */
export function createEmptyComponentSFCRuntimeDependencies(): RComponentSFC_RuntimeDependencies {
  return {
    props: [],
    boundaries: [],
  }
}
