/** Одно значение - в массив из одного элемента; массив - как есть. */
export function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  return value === undefined || value === null ? [] : [value]
}
