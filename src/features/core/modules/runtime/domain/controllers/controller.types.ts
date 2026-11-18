import type { StoreRuntimeHost } from '../../hosts/StoreRuntimeHost'
import type { RuntimeParentRef } from '../runtime-execute.type'
import type { ControllerPageCache, PageCacheOptions } from './page-cache.types'
import type { EntityOrigin } from '@/features/core/modules/domain/types/document/entity-management.type'
import type { SourceFieldDefinition } from '@/features/core/modules/source/domain/types/source-expression.types'

export interface ControllerContract {
  props: SourceFieldDefinition[]
  outputs: SourceFieldDefinition[]
  commands: Record<string, {
    input?: SourceFieldDefinition
    output?: SourceFieldDefinition
  }>
  dependencies: Record<string, {
    kind: 'store' | 'query'
    optional?: boolean
  }>
}
export interface ControllerDefinition {
  identity: string
  displayName: string
  origin: EntityOrigin
  catalogPath?: string[]
  contract: ControllerContract
  defaultProviderKey: string
}
// Code-owned model; never a persisted Domain document.
export interface ControllerModel {
  type: 'controller'
  id: string
  identity: string
  name: string
}
export type ControllerDependencyBinding = {
  store: string
  path: string
  update: string
} | {
  query: string
  output: string
  cache?: PageCacheOptions
}
export type ControllerDependencyBindings = Record<string, ControllerDependencyBinding>
export interface ControllerStateDependency {
  kind: 'store'
  read: () => unknown
  commit: (next: Record<string, unknown>, expectedRevision: number) => void
  subscribe: (listener: () => void) => () => void
}
export interface ControllerQueryDependency {
  kind: 'query'
  cache?: ControllerPageCache
  run: (input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>
}
export type ControllerDependency = ControllerStateDependency | ControllerQueryDependency
export interface ControllerContext {
  readonly props: Readonly<Record<string, unknown>>
  readonly signal: AbortSignal
  readonly dependencies: Readonly<Record<string, ControllerDependency>>
  publish: (outputs: Record<string, unknown>) => void
}
export interface ControllerInstance {
  start?: (context: ControllerContext) => void | Promise<void>
  setProps?: (props: Readonly<Record<string, unknown>>, context: ControllerContext) => void | Promise<void>
  command: (name: string, input: unknown, context: ControllerContext) => unknown | Promise<unknown>
  pause?: () => void | Promise<void>
  resume?: (context: ControllerContext) => void | Promise<void>
  destroy?: () => void | Promise<void>
}
export interface ControllerProvider {
  identity: string
  key: string
  create: (context: ControllerContext) => ControllerInstance
}
export interface ControllerMountOptions {
  owner: RuntimeParentRef
  props?: Record<string, unknown>
  dependencies?: Record<string, {
    store: StoreRuntimeHost
    path: string
    update: string
  } | {
    query: string
    output: string
    cache?: PageCacheOptions
  }>
  instanceId?: string
}
export interface ControllerProgramPayload {
  type: 'controller'
  sourceVersion: 1
  definition: ControllerDefinition
}
export interface CollectionWindowViewport {
  rowsRevision: number
  firstVisible: {
    key: string | number
    index: number
  } | null
  lastVisible: {
    key: string | number
    index: number
  } | null
  rowCount: number
  reason?: string
}
export interface CollectionWindowBlock {
  pageId?: string
  rows: Record<string, unknown>[]
  startCursor?: string | null
  endCursor?: string | null
  offset?: number
  total?: number
  sourceCount?: number
  hasBefore: boolean
  hasAfter: boolean
}
export interface CollectionWindowState {
  revision: number
  rowsRevision: number
  blocks: CollectionWindowBlock[]
  [key: string]: unknown
}
