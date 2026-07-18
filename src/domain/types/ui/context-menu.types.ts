import type { RuntimeActionId } from '@/domain/types/runtime/action.types'

export type ContextMenuItemKind = 'item' | 'separator'

export interface ContextMenuDescriptor {
  kind: 'context-menu'
  items: ContextMenuNodeDescriptor[]
}

export type ContextMenuNodeDescriptor =
  | ContextMenuItemDescriptor
  | ContextMenuSeparatorDescriptor

export interface ContextMenuItemDescriptor {
  kind: 'item'
  id: string
  label: string
  action: RuntimeActionId
  icon?: string
}

export interface ContextMenuSeparatorDescriptor {
  kind: 'separator'
  id: string
}
