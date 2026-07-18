/** Типы документа навигации из Payload (коллекция navigations). */
import type { EntityManagement } from './entity-management.type'

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
export interface NavigationDoc extends EntityManagement {
  id: number | string
  identity: string
  displayName: string
  description?: string | null
  folder?: number | string
  tree?: NavigationTreeNodeDoc[]
  meta?: Record<string, unknown>
}
