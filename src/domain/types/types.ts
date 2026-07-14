/**
 * Модель для описания того, как извлекаются данные под некоторый входной тип
 */
export interface AccessorDescriptor {
  name: string
  accessor: string
  converter?: string
}

// Разновидности компонентов (внутреннее свойство)
export enum ComponentKind {
  JSX = 'jsx', // компонент на JSX синтаксисе
  Vue = 'vue', // компонент на Vue синтаксисе
}

/**
 * Представление узла GraphQL-запроса.
 */
export interface GQLQueryNode {
  field: string
  children?: GQLQueryNode[]
  args?: Record<string, any>
}

export interface EndgeGlobalVar {
  name: string
  defaultValue: any
  currentValue: any
}

/**
 * Одна вкладка проекта в верхней панели.
 */
export interface ProjectTab {
  /** Уникальный идентификатор проекта / вкладки. */
  id: string
  /** Отображаемое имя проекта. */
  name: string
}
