// pk - путь к ключу внутри элемента массива переменной (например, id для LEGS).
// fk - путь к внешнему ключу внутри элемента переменной (например, legId для ATRS).
export type TableBinding = {
  keys: Record<
    string, // имя входной переменной
    { pk: string; fk: string }
  >
}
