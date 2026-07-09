import type { RuntimeCommandId } from '@/domain/types/command.types'

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
  command: RuntimeCommandId
  icon?: string
}

export interface ContextMenuSeparatorDescriptor {
  kind: 'separator'
  id: string
}
