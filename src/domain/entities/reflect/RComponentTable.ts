import type { RComponentTableColumn } from '@/domain/entities/reflect/RComponentTableColumn'
import type { TableBinding } from '@/domain/types/runtime/table-binding.types'

import { RComponentBase } from '@/domain/entities/reflect/RComponentBase'

/** Архивный table-документ без compile/runtime поведения. */
export class RComponentTable extends RComponentBase {
  /** Полная сохранённая структура колонок. */
  columns: RComponentTableColumn[] = []

  /** Поле inputFields, содержащее строки таблицы. */
  sourceIndex: string = ''

  /** Persisted key bindings старой таблицы. */
  bindings: TableBinding = { keys: {} }

  /** Сохранённая высота строки. */
  rowSize: string | number | 'zoom' = 40
}
