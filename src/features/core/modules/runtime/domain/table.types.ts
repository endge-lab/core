/**
 * Описание сортировки, привязанное к колонке.
 * Направление (asc/desc) задаётся пользователем в рантайме.
 */
export interface ColumnSortConfig {
  /**
   * ключ внутри колонки (обычно один из keys dataPaths),
   * например: "status" / "data" / "number"
   */
  by: string
  /**
   * "String" | "Number" | "Date" | "DateTime" ...
   */
  type: string
}
