export type EndgeBindingMode = 'replace' | 'append' | 'prepend' | 'disable'

export type EndgeResolveSelectionMode = 'all' | 'inherited-only' | 'direct-only'

export interface EndgeResolveOptions {
  ownerType: string
  ownerId: number
  targetType?: string | null
  targetId?: number | null
  selector?: string | null
  environmentId?: number | null
}

export interface EndgeResolvedOverrideBase {
  id: number | null
  identity: string
  displayName: string
  ownerType: string
  ownerId: number
  targetType: string
  targetId: number | null
  selector: string
  mode: EndgeBindingMode
  priority: number
  isEnabled: boolean
  environmentId: number | null
  isInherited: boolean
  originBindingId: number | null
  sourceOwnerType: string
  sourceOwnerId: number
  source: 'direct' | 'inherited'
  depth: number
}

export interface EndgeResolveSourceCommon {
  id?: unknown
  identity?: unknown
  displayName?: unknown
  name?: unknown
  ownerType?: unknown
  ownerId?: unknown
  targetType?: unknown
  targetId?: unknown
  mode?: unknown
  priority?: unknown
  isEnabled?: unknown
  environmentId?: unknown
  originBindingId?: unknown
}

export interface EndgeResolveBuildContext {
  requestedOwnerType: string
  requestedOwnerId: number
  requestedTargetType: string
  requestedTargetId: number | null
  selector: string
  id: number | null
  identity: string
  displayName: string
  mode: EndgeBindingMode
  priority: number
  isEnabled: boolean
  environmentId: number | null
  originBindingId: number | null
  sourceOwnerType: string
  sourceOwnerId: number
  source: 'direct' | 'inherited'
  depth: number
}

export interface EndgeResolveEngineConfig<
  TSource extends EndgeResolveSourceCommon,
  TResolved extends EndgeResolvedOverrideBase,
> {
  getSource: () => TSource[]
  getSelector: (raw: TSource) => unknown
  buildResolved: (raw: TSource, ctx: EndgeResolveBuildContext) => TResolved | null
  isResolvedValid?: (item: TResolved) => boolean
}
