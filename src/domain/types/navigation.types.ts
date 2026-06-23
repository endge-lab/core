/** Типы документа навигации из Payload (коллекция navigations). */

/** Узел полного дерева навигации. */
export interface NavigationTreeNodeDoc {
  id?: string | null
  type: 'link' | 'group'
  title: string
  icon?: string | null
  hidden?: boolean
  disabled?: boolean
  collapsedTitle?: string | null
  path?: string | null
  routeName?: string | null
  external?: boolean
  children?: NavigationTreeNodeDoc[]
}

/** Документ навигации из Payload. */
export interface NavigationDoc {
  id: number | string
  identity: string
  displayName: string
  description?: string | null
  folder?: number | string
  project?: number | string
  isSystem?: boolean
  tree?: NavigationTreeNodeDoc[]
  meta?: Record<string, unknown>
}
