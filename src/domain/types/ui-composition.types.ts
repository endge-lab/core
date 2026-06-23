export type UIPrimitiveKind
  = | 'page'
    | 'flex'
    | 'grid'
    | 'box'
    | 'custom-component'
    | 'text'
    | 'button'

export interface UIAstNodeLayout {
  colStart: number
  rowStart: number
  span: number
  rowSpan: number
}

export interface UIAstNodeReference {
  definitionRef: string
  configRef?: string | null
  assetRef?: string | null
}

export interface UIAstNodeBase<
  TKind extends UIPrimitiveKind = UIPrimitiveKind,
  TProps extends Record<string, unknown> = Record<string, unknown>,
> extends UIAstNodeReference {
  id: string
  kind: TKind
  name: string
  children: string[]
  props: TProps
  layout?: UIAstNodeLayout
  meta?: Record<string, unknown>
}

export interface UIAstDocument<TNode extends UIAstNodeBase = UIAstNodeBase> {
  id: string
  version: number
  rootId: string
  nodes: Record<string, TNode>
}

export type UIPresentationSurface = 'canvas' | 'admin' | 'runtime'
export type UILegacyComponentRenderHost = 'view' | 'table-cell' | 'canvas'

export interface UIPresentationRoleContract {
  role: string
  description: string
  supportedSurfaces: UIPresentationSurface[]
  defaultRendererRefs?: Partial<Record<UIPresentationSurface, string>>
}

export interface UIPresentationContract {
  id: string
  roles: UIPresentationRoleContract[]
}

export interface UIPresentationBinding {
  ownerType: string
  ownerId: string | number
  targetType: 'ui-definition' | 'ui-config' | 'ui-asset' | 'ui-ast-node'
  targetId: string
  role: string
  surface: UIPresentationSurface
  rendererRef: string
  mode: 'replace' | 'append' | 'prepend' | 'disable'
  priority: number
}

export interface UIComponentDefinition<
  TProps extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string
  title: string
  description: string
  groupId: string
  groupTitle: string
  groupDescription: string
  primitiveKind: UIPrimitiveKind
  jsxTag: string
  supportsChildren: boolean
  paletteVisible: boolean
  canvasAccentClass: string
  keywords?: string[]
  configKind?: string | null
  defaultNodeName: string
  defaultProps: TProps
  defaultLayout?: UIAstNodeLayout
  defaultRendererRef?: string
  allowsRendererRefOverride?: boolean
  stubDescription?: string
  presentationContract: UIPresentationContract
}

export interface UIComponentDefinitionGroup {
  id: string
  title: string
  description: string
}

export interface UIComponentConfigDefinition {
  kind: string
  title: string
  description: string
  definitionRef: string
}

export interface UIComponentConfigDocument<TData extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  kind: string
  definitionRef: string
  title: string
  data: TData
}

export interface UIComponentPresetDocument {
  id: string
  title: string
  description: string
  definitionRef: string
  configRef?: string | null
  assetRef?: string | null
  propsPatch?: Record<string, unknown>
  layoutPatch?: Partial<UIAstNodeLayout>
  keywords?: string[]
}

export interface UIComponentAssetDocument<TNode extends UIAstNodeBase = UIAstNodeBase> {
  id: string
  title: string
  definitionRef?: string | null
  description?: string
  ast: {
    rootId: string
    nodes: Record<string, TNode>
  }
  defaultConfigRef?: string | null
}

export interface UIJsxElementNode {
  type: 'element'
  tag: string
  attributes: Record<string, string | number | boolean | null>
  children: UIJsxNode[]
}

export interface UIJsxTextNode {
  type: 'text'
  value: string
}

export type UIJsxNode = UIJsxElementNode | UIJsxTextNode

export interface UIJsxComponentDocument<TNode extends UIAstNodeBase = UIAstNodeBase> {
  id: string
  title: string
  description: string
  definitionRef: string
  jsxSource: string
  keywords?: string[]
  ast: {
    rootId: string
    nodes: Record<string, TNode>
  }
}

export interface UIComponentRendererRegistration {
  ref: string
  definitionRef: string
  surface: UIPresentationSurface
  role: string
  component: any
  label?: string
  makeDefault?: boolean
}

export interface UIResolvedComponentRenderer {
  ref: string
  definitionRef: string
  surface: UIPresentationSurface
  role: string
  component: any
  label?: string
}

export interface UILegacyComponentRendererRegistration {
  ref: string
  componentId?: string | number | null
  componentIdentity?: string | null
  host: UILegacyComponentRenderHost
  renderType?: 'functional' | 'component'
  component: any
  label?: string
}

export interface UIResolvedLegacyComponentRenderer {
  ref: string
  componentId?: string | number | null
  componentIdentity?: string | null
  host: UILegacyComponentRenderHost
  renderType: 'functional' | 'component'
  component: any
  label?: string
}

export interface UIResolveLegacyComponentRendererOptions {
  componentId?: string | number | null
  componentIdentity?: string | null
  host: UILegacyComponentRenderHost
  rendererRef?: string | null
}

export interface UIResolveRendererOptions {
  definitionRef: string
  surface: UIPresentationSurface
  role?: string
  rendererRef?: string | null
}

export interface UIRegistrySnapshot {
  definitions: string[]
  configDefinitions: string[]
  presets: string[]
  jsxComponents: string[]
  legacyRenderers: string[]
  renderers: string[]
}

export interface UIRegistryNodeDraft {
  id: string
  definitionRef: string
  name?: string
  propsPatch?: Record<string, unknown>
  layoutPatch?: Partial<UIAstNodeLayout>
  configRef?: string | null
  assetRef?: string | null
  meta?: Record<string, unknown>
}

export function getUIJsxTagName(definition: Pick<UIComponentDefinition, 'jsxTag'>): string {
  return definition.jsxTag
}
