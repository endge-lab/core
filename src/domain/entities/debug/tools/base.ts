/**
 * Генерирует случайную шестнадцатеричную строку заданной длины.
 * Пример: rndHex(8) - "a3f92b10"
 */
export function rndHex(length: number = 8): string {
  const bytes = new Uint8Array(Math.ceil(length / 2))
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length)
}
