import { Serialize } from '@endge/utils'
import { Expose } from 'class-transformer'

import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'
import { REntity } from '@/domain/entities/reflect/REntity'
import type { DomainDocumentType } from '@/domain/types/document.types'
import type { NavigationTreeNodeDoc } from '@/domain/types/navigation.types'

export interface RNavigationSchema {
  id: string
  identity: string
  name: string
  displayName?: string
  description?: string | null
  isSystem?: boolean
  folderId?: string | number | null
  project?: string | number | null
  tree?: NavigationTreeNodeDoc[]
  meta?: Record<string, unknown>
}

function cloneTreeNode(node: NavigationTreeNodeDoc): NavigationTreeNodeDoc {
  return {
    id: node.id ?? null,
    type: node.type,
    title: node.title,
    icon: node.icon ?? null,
    hidden: node.hidden ?? false,
    disabled: node.disabled ?? false,
    collapsedTitle: node.collapsedTitle ?? null,
    path: node.path ?? null,
    routeName: node.routeName ?? null,
    external: node.external ?? false,
    children: Array.isArray(node.children) ? node.children.map(cloneTreeNode) : [],
  }
}

/** Навигация (коллекция navigations). */
export class RNavigation extends REntity {
  @Expose()
  description: string | null = null

  @Expose()
  tree: NavigationTreeNodeDoc[] = []

  /** Тип документа для редактора/инспектора. */
  get type(): DomainDocumentType {
    return 'navigation' as DomainDocumentType
  }

  toPlain(): RNavigationSchema {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      displayName: this.displayName ?? this.name,
      description: this.description ?? null,
      isSystem: this.isSystem,
      folderId: this.folderId ?? null,
      project: this.project ?? null,
      tree: this.tree?.length ? this.tree.map(cloneTreeNode) : undefined,
      meta: this.meta && Object.keys(this.meta).length > 0 ? { ...this.meta } : undefined,
    }
  }

  override duplicate(options: DuplicateOptions): RNavigation {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return Serialize.fromJSON(RNavigation, plain)
  }
}
