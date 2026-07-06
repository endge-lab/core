/** Типы документа навигации из Payload (коллекция navigations). */

interface NavigationTreeNodeBaseDoc {
  id?: string | null
  title: string
  icon?: string | null
  hidden?: boolean
  disabled?: boolean
  collapsedTitle?: string | null
  path?: string | null
  routeName?: string | null
  external?: boolean
}

export interface NavigationSectionNodeDoc extends NavigationTreeNodeBaseDoc {
  type: 'section'
  children?: NavigationTreeNodeDoc[]
}

export interface NavigationGroupNodeDoc extends NavigationTreeNodeBaseDoc {
  type: 'group'
  children?: NavigationTreeNodeDoc[]
}

export interface NavigationLinkNodeDoc extends NavigationTreeNodeBaseDoc {
  type: 'link'
}

/** Узел полного дерева навигации. */
export type NavigationTreeNodeDoc =
  | NavigationSectionNodeDoc
  | NavigationGroupNodeDoc
  | NavigationLinkNodeDoc

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
