import type { RComponentTableColumn } from '@/modules/domain/entities/RComponentTableColumn'
import type { TableBinding } from '@/modules/runtime/domain/table-binding.types'

import { RComponentBase } from '@/modules/domain/entities/RComponentBase'

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
