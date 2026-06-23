/**
 * Типы для системы стилей Endge (новый формат).
 *
 * В Payload поле `styles` хранится как JSON-массив (по умолчанию `[]`):
 *
 * [
 *   {
 *     "component:my-table-id": {
 *       "backgroundColor": "red",
 *       "tag-root:root-id": {
 *         "padding": "8px"
 *       }
 *     }
 *   }
 * ]
 *
 * Ключи вида "<selectorType>:<id>" описывают селекторы (вложенность как в SCSS),
 * остальные ключи - CSS-свойства в camelCase.
 */

/** Ключ селектора в JSON, например "component:my-table-id". */
export type StyleSelectorKey = string

/** Один объект-блок с деревом вложенных селекторов и свойств. */
export type StyleJsonBlock = Record<string, any>

/** Весь JSON стиля - массив блоков. */
export type StyleBlocksPayload = StyleJsonBlock[]

