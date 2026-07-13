import type {
  UIAstNodeBase,
  UIAstNodeLayout,
  UIComponentConfigDefinition,
  UIComponentDefinition,
  UIComponentPresetDocument,
  UIComponentDefinitionGroup,
  UIComponentRendererRegistration,
  UILegacyComponentRendererRegistration,
  UILegacyComponentRenderHost,
  UIResolveLegacyComponentRendererOptions,
  UIResolvedLegacyComponentRenderer,
  UIJsxComponentDocument,
  UIPrimitiveKind,
  UIRegistryNodeDraft,
  UIRegistrySnapshot,
  UIResolveRendererOptions,
  UIResolvedComponentRenderer,
  UIPresentationRoleContract,
  UIPresentationSurface,
} from '@/domain/types/ui-composition.types'

import { markRaw } from 'vue'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import {
  ENDGE_UI_DEFAULT_CONFIG_DEFINITIONS,
  ENDGE_UI_DEFAULT_DEFINITIONS,
  ENDGE_UI_DEFAULT_JSX_COMPONENTS,
  ENDGE_UI_DEFAULT_PRESET_COMPONENTS,
  UI_COMPONENT_HOST_DEFINITION_ID,
} from '@/model/config/ui-composition-defaults'
import { UIAdapterRegistry } from '@/model/endge/ui-registry/UIAdapterRegistry'

function clonePlainValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function rendererIndexKey(input: {
  definitionRef: string
  surface: UIPresentationSurface
  role: string
}): string {
  return `${input.definitionRef}::${input.surface}::${input.role}`
}

function legacyRendererIndexKeys(input: {
  componentId?: string | number | null
  componentIdentity?: string | null
  host: UILegacyComponentRenderHost
}): string[] {
  const keys: string[] = []
  const normalizedId = input.componentId == null ? '' : String(input.componentId).trim()
  const normalizedIdentity = String(input.componentIdentity ?? '').trim()
  if (normalizedId) {
    keys.push(`id:${normalizedId}::${input.host}`)
  }
  if (normalizedIdentity) {
    keys.push(`identity:${normalizedIdentity}::${input.host}`)
  }
  return keys
}

export class EndgeUIRegistry extends EndgeModule {
  public readonly adapters = new UIAdapterRegistry(() => this.notify())

  private _definitions = new Map<string, UIComponentDefinition>()
  private _configDefinitions = new Map<string, UIComponentConfigDefinition>()
  private _presetComponents = new Map<string, UIComponentPresetDocument>()
  private _jsxComponents = new Map<string, UIJsxComponentDocument>()
  private _legacyRenderersByRef = new Map<string, UIResolvedLegacyComponentRenderer>()
  private _legacyRendererRefsByIndex = new Map<string, string[]>()
  private _renderersByRef = new Map<string, UIResolvedComponentRenderer>()
  private _rendererRefsByIndex = new Map<string, string[]>()

  /**
   * Создает registry и регистрирует системные UI definitions.
   */
  public constructor() {
    super()
    this.reset()
  }

  /**
   * Очищает registry и восстанавливает default UI definitions.
   */
  public override reset(): void {
    this._definitions.clear()
    this._configDefinitions.clear()
    this._presetComponents.clear()
    this._jsxComponents.clear()
    this._legacyRenderersByRef.clear()
    this._legacyRendererRefsByIndex.clear()
    this._renderersByRef.clear()
    this._rendererRefsByIndex.clear()
    this.adapters.reset()

    this.registerDefinitions(ENDGE_UI_DEFAULT_DEFINITIONS)
    this.registerConfigDefinitions(ENDGE_UI_DEFAULT_CONFIG_DEFINITIONS)
    this.registerPresetComponents(ENDGE_UI_DEFAULT_PRESET_COMPONENTS)
    this.registerJsxComponents(ENDGE_UI_DEFAULT_JSX_COMPONENTS)
  }

  /**
   * Возвращает snapshot зарегистрированных UI refs.
   */
  public override serialize(): UIRegistrySnapshot {
    return {
      definitions: [...this._definitions.keys()],
      configDefinitions: [...this._configDefinitions.keys()],
      presets: [...this._presetComponents.keys()],
      jsxComponents: [...this._jsxComponents.keys()],
      legacyRenderers: [...this._legacyRenderersByRef.keys()],
      renderers: [...this._renderersByRef.keys()],
      adapters: this.adapters.list(),
      activeAdapterId: this.adapters.active?.id ?? null,
    }
  }

  /**
   * Регистрирует UI component definitions.
   */
  public registerDefinitions(definitions: UIComponentDefinition[]): void {
    for (const definition of definitions) {
      this._definitions.set(definition.id, clonePlainValue(definition))
    }
    this.notify()
  }

  /**
   * Регистрирует config definitions для UI components.
   */
  public registerConfigDefinitions(definitions: UIComponentConfigDefinition[]): void {
    for (const definition of definitions) {
      this._configDefinitions.set(definition.kind, clonePlainValue(definition))
    }
    this.notify()
  }

  /**
   * Регистрирует preset components для palette/library.
   */
  public registerPresetComponents(components: UIComponentPresetDocument[]): void {
    for (const component of components) {
      this._presetComponents.set(component.id, clonePlainValue(component))
    }
    this.notify()
  }

  /**
   * Регистрирует JSX components для UI editor palette.
   */
  public registerJsxComponents(components: UIJsxComponentDocument[]): void {
    for (const component of components) {
      this._jsxComponents.set(component.id, clonePlainValue(component))
    }
    this.notify()
  }

  /**
   * Возвращает список UI definitions с optional фильтрацией.
   */
  public listDefinitions(input?: {
    includeSystem?: boolean
    paletteOnly?: boolean
  }): UIComponentDefinition[] {
    return [...this._definitions.values()].filter((definition) => {
      if (input?.paletteOnly && !definition.paletteVisible) {
        return false
      }
      if (!input?.includeSystem && definition.groupId === 'system') {
        return false
      }
      return true
    })
  }

  /**
   * Возвращает группы visible definitions для palette.
   */
  public listDefinitionGroups(): UIComponentDefinitionGroup[] {
    const groups = new Map<string, UIComponentDefinitionGroup>()
    for (const definition of this.listDefinitions({ paletteOnly: true })) {
      if (!groups.has(definition.groupId)) {
        groups.set(definition.groupId, {
          id: definition.groupId,
          title: definition.groupTitle,
          description: definition.groupDescription,
        })
      }
    }
    return [...groups.values()]
  }

  /**
   * Возвращает UI definition по ref.
   */
  public getDefinition(definitionRef: string | null | undefined): UIComponentDefinition | null {
    if (!definitionRef) {
      return null
    }
    return this._definitions.get(definitionRef) ?? null
  }

  /**
   * Возвращает UI definition или выбрасывает ошибку, если ref неизвестен.
   */
  public getDefinitionOrThrow(definitionRef: string): UIComponentDefinition {
    const definition = this.getDefinition(definitionRef)
    if (!definition) {
      throw new Error(`[EndgeUIRegistry] unknown definition: ${definitionRef}`)
    }
    return definition
  }

  /**
   * Возвращает config definition по kind.
   */
  public getConfigDefinition(kind: string | null | undefined): UIComponentConfigDefinition | null {
    if (!kind) {
      return null
    }
    return this._configDefinitions.get(kind) ?? null
  }

  /**
   * Возвращает зарегистрированные preset components.
   */
  public listPresetComponents(): UIComponentPresetDocument[] {
    return [...this._presetComponents.values()].map(item => clonePlainValue(item))
  }

  /**
   * Возвращает зарегистрированные JSX components.
   */
  public listJsxComponents(): UIJsxComponentDocument[] {
    return [...this._jsxComponents.values()].map(item => clonePlainValue(item))
  }

  /**
   * Возвращает preset component по id.
   */
  public getPresetComponent(componentId: string | null | undefined): UIComponentPresetDocument | null {
    if (!componentId) {
      return null
    }
    const component = this._presetComponents.get(componentId)
    return component ? clonePlainValue(component) : null
  }

  /**
   * Возвращает JSX component по id.
   */
  public getJsxComponent(componentId: string | null | undefined): UIJsxComponentDocument | null {
    if (!componentId) {
      return null
    }
    const component = this._jsxComponents.get(componentId)
    return component ? clonePlainValue(component) : null
  }

  /**
   * Регистрирует legacy renderer для runtime/view совместимости.
   */
  public registerLegacyComponentRenderer(input: UILegacyComponentRendererRegistration): void {
    const renderer: UIResolvedLegacyComponentRenderer = {
      ref: input.ref,
      componentId: input.componentId ?? null,
      componentIdentity: String(input.componentIdentity ?? '').trim() || null,
      host: input.host,
      renderType: input.renderType === 'component' ? 'component' : 'functional',
      component: markRaw(input.component),
      label: input.label,
    }

    this._legacyRenderersByRef.set(renderer.ref, renderer)
    for (const key of legacyRendererIndexKeys(renderer)) {
      const refs = this._legacyRendererRefsByIndex.get(key) ?? []
      if (!refs.includes(renderer.ref)) {
        refs.unshift(renderer.ref)
      }
      this._legacyRendererRefsByIndex.set(key, refs)
    }

    this.notify()
  }

  /**
   * Возвращает legacy renderer по его ссылке.
   */
  public getLegacyComponentRendererByRef(rendererRef: string | null | undefined): UIResolvedLegacyComponentRenderer | null {
    if (!rendererRef) {
      return null
    }
    return this._legacyRenderersByRef.get(rendererRef) ?? null
  }

  /**
   * Подбирает legacy renderer по явной ссылке или по параметрам старой component-модели.
   */
  public resolveLegacyComponentRenderer(input: UIResolveLegacyComponentRendererOptions): UIResolvedLegacyComponentRenderer | null {
    if (input.rendererRef) {
      const explicit = this.getLegacyComponentRendererByRef(String(input.rendererRef).trim())
      if (explicit) {
        return explicit
      }
    }

    const hosts = [input.host, ...this.getLegacyFallbackHosts(input.host)]
    for (const host of hosts) {
      for (const key of legacyRendererIndexKeys({
        componentId: input.componentId,
        componentIdentity: input.componentIdentity,
        host,
      })) {
        const refs = this._legacyRendererRefsByIndex.get(key) ?? []
        for (const ref of refs) {
          const renderer = this.getLegacyComponentRendererByRef(ref)
          if (renderer) {
            return renderer
          }
        }
      }
    }

    return null
  }

  /**
   * Сопоставляет legacy primitive kind с definition ref нового UI registry.
   */
  public resolveLegacyDefinitionRef(
    kind: UIPrimitiveKind,
    props?: Record<string, unknown> | null,
  ): string {
    if (kind === 'page') {
      return 'ui.page'
    }
    if (kind === 'text') {
      return 'ui.text'
    }
    if (kind === 'button') {
      return 'ui.button'
    }
    if (kind === 'box') {
      return 'ui.box'
    }
    if (kind === 'grid') {
      return 'ui.grid'
    }
    if (kind === 'flex') {
      return props?.direction === 'row'
        ? 'ui.inline'
        : 'ui.stack'
    }
    return UI_COMPONENT_HOST_DEFINITION_ID
  }

  /**
   * Возвращает layout по умолчанию для definition.
   */
  public getDefinitionDefaultLayout(definitionRef: string): UIAstNodeLayout | undefined {
    const definition = this.getDefinitionOrThrow(definitionRef)
    return definition.defaultLayout ? clonePlainValue(definition.defaultLayout) : undefined
  }

  /**
   * Возвращает props по умолчанию для definition.
   */
  public getDefinitionDefaultProps(definitionRef: string): Record<string, unknown> {
    const definition = this.getDefinitionOrThrow(definitionRef)
    return clonePlainValue(definition.defaultProps)
  }

  /**
   * Создает UI AST node на основе definition и пользовательских patch-значений.
   */
  public createNodeFromDefinition(input: UIRegistryNodeDraft): UIAstNodeBase {
    const definition = this.getDefinitionOrThrow(input.definitionRef)
    const nextLayout = definition.defaultLayout
      ? {
          ...clonePlainValue(definition.defaultLayout),
          ...(input.layoutPatch ?? {}),
        }
      : undefined

    const nextProps = {
      ...this.getDefinitionDefaultProps(definition.id),
      ...(input.propsPatch ?? {}),
    }

    if ('rendererRef' in nextProps && !String(nextProps.rendererRef ?? '').trim() && definition.defaultRendererRef) {
      nextProps.rendererRef = definition.defaultRendererRef
    }

    return {
      id: input.id,
      kind: definition.primitiveKind,
      definitionRef: definition.id,
      configRef: input.configRef ?? null,
      assetRef: input.assetRef ?? null,
      name: input.name?.trim() || definition.defaultNodeName,
      children: [],
      props: nextProps,
      layout: nextLayout,
      meta: input.meta ? { ...input.meta } : undefined,
    }
  }

  /**
   * Создает корневую page-ноду для UI AST.
   */
  public createRootNode(input?: {
    id?: string
    propsPatch?: Record<string, unknown>
  }): UIAstNodeBase<'page'> {
    return this.createNodeFromDefinition({
      id: input?.id ?? 'ui-page-root',
      definitionRef: 'ui.page',
      name: 'Page',
      propsPatch: input?.propsPatch,
    }) as UIAstNodeBase<'page'>
  }

  /**
   * Нормализует node относительно зарегистрированной definition.
   */
  public normalizeNodeDefinition<TNode extends UIAstNodeBase>(
    node: TNode,
  ): TNode {
    const definitionRef = node.definitionRef || this.resolveLegacyDefinitionRef(node.kind, node.props)
    const definition = this.getDefinition(definitionRef)
    if (!definition) {
      return {
        ...node,
        definitionRef,
      }
    }

    return {
      ...node,
      kind: definition.primitiveKind,
      definitionRef,
      props: {
        ...this.getDefinitionDefaultProps(definition.id),
        ...clonePlainValue(node.props),
      },
    }
  }

  /**
   * Регистрирует renderer для definition/surface/role.
   */
  public registerRenderer(input: UIComponentRendererRegistration): void {
    const renderer: UIResolvedComponentRenderer = {
      ref: input.ref,
      definitionRef: input.definitionRef,
      surface: input.surface,
      role: String(input.role ?? 'main').trim() || 'main',
      component: markRaw(input.component),
      label: input.label,
    }

    this._renderersByRef.set(renderer.ref, renderer)
    const key = rendererIndexKey(renderer)
    const refs = this._rendererRefsByIndex.get(key) ?? []
    if (!refs.includes(renderer.ref)) {
      refs.unshift(renderer.ref)
    }
    this._rendererRefsByIndex.set(key, refs)

    if (input.makeDefault) {
      this.setDefaultRendererRef(renderer.definitionRef, renderer.surface, renderer.role, renderer.ref)
    }

    this.notify()
  }

  /**
   * Назначает renderer по умолчанию для роли и поверхности definition.
   */
  public setDefaultRendererRef(
    definitionRef: string,
    surface: UIPresentationSurface,
    role: string,
    rendererRef: string,
  ): void {
    const definition = this.getDefinitionOrThrow(definitionRef)
    const nextDefinition = clonePlainValue(definition)
    const normalizedRole = String(role ?? 'main').trim() || 'main'

    let roleContract = nextDefinition.presentationContract.roles
      .find(item => item.role === normalizedRole)

    if (!roleContract) {
      roleContract = {
        role: normalizedRole,
        description: `Renderer role ${normalizedRole}`,
        supportedSurfaces: [surface],
        defaultRendererRefs: {},
      }
      nextDefinition.presentationContract.roles.push(roleContract)
    }

    if (!roleContract.supportedSurfaces.includes(surface)) {
      roleContract.supportedSurfaces.push(surface)
    }
    roleContract.defaultRendererRefs = {
      ...(roleContract.defaultRendererRefs ?? {}),
      [surface]: rendererRef,
    }

    this._definitions.set(definitionRef, nextDefinition)
    this.notify()
  }

  /**
   * Возвращает renderer по его ссылке.
   */
  public getRendererByRef(rendererRef: string | null | undefined): UIResolvedComponentRenderer | null {
    if (!rendererRef) {
      return null
    }
    return this._renderersByRef.get(rendererRef) ?? null
  }

  /**
   * Подбирает renderer по definition, surface, role и возможной явной ссылке.
   */
  public resolveRenderer(input: UIResolveRendererOptions): UIResolvedComponentRenderer | null {
    const definition = this.getDefinition(input.definitionRef)
    if (!definition) {
      return null
    }

    if (input.rendererRef) {
      const explicit = this.getRendererByRef(String(input.rendererRef).trim())
      if (explicit) {
        return explicit
      }
    }

    const role = String(input.role ?? 'main').trim() || 'main'
    const roleContract = definition.presentationContract.roles.find(item => item.role === role)
    const candidateRefs: string[] = []

    const pushRef = (ref: string | null | undefined) => {
      const normalized = String(ref ?? '').trim()
      if (normalized && !candidateRefs.includes(normalized)) {
        candidateRefs.push(normalized)
      }
    }

    pushRef(roleContract?.defaultRendererRefs?.[input.surface])

    for (const fallbackSurface of this.getFallbackSurfaces(input.surface)) {
      pushRef(roleContract?.defaultRendererRefs?.[fallbackSurface])
    }

    for (const ref of candidateRefs) {
      const renderer = this.getRendererByRef(ref)
      if (renderer) {
        return renderer
      }
    }

    const indexed = this._rendererRefsByIndex.get(rendererIndexKey({
      definitionRef: input.definitionRef,
      role,
      surface: input.surface,
    })) ?? []
    for (const ref of indexed) {
      const renderer = this.getRendererByRef(ref)
      if (renderer) {
        return renderer
      }
    }

    for (const fallbackSurface of this.getFallbackSurfaces(input.surface)) {
      const fallbackIndexed = this._rendererRefsByIndex.get(rendererIndexKey({
        definitionRef: input.definitionRef,
        role,
        surface: fallbackSurface,
      })) ?? []
      for (const ref of fallbackIndexed) {
        const renderer = this.getRendererByRef(ref)
        if (renderer) {
          return renderer
        }
      }
    }

    return null
  }

  /**
   * Возвращает Fallback Surfaces.
   */
  private getFallbackSurfaces(surface: UIPresentationSurface): UIPresentationSurface[] {
    if (surface === 'admin') {
      return ['canvas', 'runtime']
    }
    if (surface === 'runtime') {
      return ['admin', 'canvas']
    }
    return ['admin', 'runtime']
  }

  /**
   * Возвращает Legacy Fallback Hosts.
   */
  private getLegacyFallbackHosts(host: UILegacyComponentRenderHost): UILegacyComponentRenderHost[] {
    if (host === 'table-cell') {
      return ['view', 'canvas']
    }
    if (host === 'view') {
      return ['table-cell', 'canvas']
    }
    return ['view', 'table-cell']
  }
}

export function getUIPresentationRoleContract(
  definition: UIComponentDefinition,
  role: string,
): UIPresentationRoleContract | null {
  return definition.presentationContract.roles.find(item => item.role === role) ?? null
}
