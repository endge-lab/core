/**
 * Константы классов и атрибутов для генерации HTML из JSX/DSL.
 * Используются для стилизации и идентификации тегов и компонентов в DOM.
 */
export const EndgeJsxAttr = {
  /** Класс тега верхнего уровня в дереве DSL */
  TagRoot: 'endge-tag-root',

  /** Класс любого вложенного тега (в т.ч. внутри v-if/v-else) */
  Tag: 'endge-tag',

  /** Атрибут уникального идентификатора тега в дереве */
  TagIdentity: 'endge-tag-identity',

  /** Атрибут идентификатора компонента из домена (на верхнем уровне обёртки). Для отображения, может меняться. */
  ComponentIdentity: 'endge-component-identity',

  /** Стабильный id компонента для селекторов стилей (не меняется при смене identity). */
  ComponentId: 'data-endge-component-id',
} as const
