import type {
  AnyEndgeModule,
  EndgeFederationContextOf,
  EndgeFederationModuleAccessors,
  EndgeModuleDefinition,
  EndgeModuleDefinitions,
  EndgeModuleDescriptor,
  EndgeModuleOrder,
} from '@/features/federation/types/endge-modules.types'
import type {
  AnyEndgeFederation,
  EndgeChildFederationDefinition,
  EndgeChildFederationDefinitions,
  EndgeFederationContext,
  EndgeFederationDefinition,
  EndgeFederationHost,
  EndgeFederationState,
  EndgeLifecycleNodeDescriptor,
  EndgePlugin,
} from '@/features/federation/types/federation.types'

import { ENDGE_FEDERATION_REGISTRY_KEY } from '@/features/federation/constants/federation.constants'
import { sortEndgeOrderedDescriptors } from '@/features/federation/tools/sort-endge-modules'

type EndgeFederationPhase = 'setup' | 'load' | 'build' | 'start'

const ENDGE_FEDERATION_CONTROL_KEY = Symbol.for('endge.federation.control.v1')

function toArray(value: EndgeModuleOrder | undefined): string[] {
  if (!value) {
    return []
  }
  return typeof value === 'string' ? [value] : [...value]
}

type UnionToIntersection<TValue>
  = (TValue extends unknown ? (value: TValue) => void : never) extends ((value: infer TResult) => void)
    ? TResult
    : never

type EndgeChildFederationContext<TFederation>
  = TFederation extends { boot: (ctx: infer TContext) => Promise<void> }
    ? TContext
    : EndgeFederationContext

type EndgeChildFederationsContext<TDefinitions extends EndgeChildFederationDefinitions>
  = [TDefinitions[number]] extends [never]
    ? EndgeFederationContext
    : UnionToIntersection<EndgeChildFederationContext<TDefinitions[number]['federation']>> extends infer TContext extends EndgeFederationContext
      ? TContext
      : EndgeFederationContext

type EndgeFederationConstructor = abstract new (...args: any[]) => EndgeFederation
type EndgeFederationStatics = Omit<typeof EndgeFederation, 'prototype' | 'boot' | 'build'>

type EndgeFederationAccessors<TDefinitions extends EndgeChildFederationDefinitions> = {
  readonly [TDefinition in TDefinitions[number] as TDefinition['key']]: TDefinition['federation']
}

export type DefinedEndgeFederation<
  TDefinitions extends EndgeModuleDefinitions,
  TFederations extends EndgeChildFederationDefinitions = readonly [],
  TContext extends EndgeFederationContext = EndgeFederationContextOf<TDefinitions> & EndgeChildFederationsContext<TFederations>,
> = EndgeFederationConstructor
  & EndgeFederationStatics
  & EndgeFederationModuleAccessors<TDefinitions>
  & EndgeFederationAccessors<TFederations>
  & {
    readonly prototype: EndgeFederation
    boot: (ctx: TContext) => Promise<void>
    build: (ctx?: TContext) => Promise<void>
  }

interface EndgeFederationControl {
  readonly id: string
  attach: (parentFederationId: string) => void
  configure: () => void
  runPhase: (phase: EndgeFederationPhase, ctx: EndgeFederationContext) => Promise<void>
  reset: () => Promise<void>
}

/**
 * Общая статическая федерация lifecycle-узлов.
 * Хост федерации живёт в `globalThis`, поэтому один и тот же id
 * остаётся singleton даже при загрузке из разных пакетов/бандлов.
 */
export abstract class EndgeFederation {
  protected static readonly federationId: string = 'default'
  protected static readonly federationDefinitionSignature: string | null = null

  /** Стабильная runtime identity Federation. */
  public static get id(): string {
    return this._getFederationId()
  }

  /** Создаёт Federation с ленивыми Modules и дочерними Federations. */
  public static define<
    const TDefinitions extends EndgeModuleDefinitions,
    const TFederations extends EndgeChildFederationDefinitions = readonly [],
  >(
    definition: EndgeFederationDefinition<TDefinitions, TFederations>,
  ): DefinedEndgeFederation<TDefinitions, TFederations> {
    const federationId = String(definition.id ?? '').trim()
    if (!federationId) {
      throw new Error('[EndgeFederation.define] federation id is required')
    }

    const moduleDefinitions = this._normalizeModuleDefinitions(definition.modules)
    const federationDefinitions = this._normalizeFederationDefinitions(definition.federations ?? [])
    const definitionSignature = this._createDefinitionSignature(moduleDefinitions, federationDefinitions)

    class DefinedFederation extends EndgeFederation {
      protected static override readonly federationId = federationId
      protected static override readonly federationDefinitionSignature = definitionSignature

      protected static override configureFederation(): void {
        this.defineModuleDefinitions(moduleDefinitions)
        this.defineFederations(federationDefinitions)
      }
    }

    Object.defineProperty(DefinedFederation, 'name', {
      configurable: true,
      value: String(definition.name ?? federationId).trim() || federationId,
    })

    this._defineAccessors(DefinedFederation, moduleDefinitions, federationDefinitions)

    return DefinedFederation as DefinedEndgeFederation<TDefinitions, TFederations>
  }

  public static get isInitialized(): boolean {
    return this.state === 'ready' || this.state === 'building'
  }

  public static get isConfigured(): boolean {
    return this._getOrCreateHost().isConfigured
  }

  public static get state(): EndgeFederationState {
    return this._getOrCreateHost().state
  }

  public static get lastError(): unknown | null {
    return this._getOrCreateHost().lastError
  }

  /** Хук одноразовой декларации собственных lifecycle-узлов Federation. */
  protected static configureFederation(): void {}

  /** Запускает всё дерево Federation по pipeline `setup -> load -> build -> start`. */
  public static boot(ctx: EndgeFederationContext): Promise<void> {
    const host = this._getOrCreateHost()
    if (host.parentFederationId) {
      return Promise.reject(new Error(
        `[${this.name}] lifecycle is managed by parent federation "${host.parentFederationId}"`,
      ))
    }

    this._ensureConfigured()

    if (host.state === 'booting') {
      if (host.bootContext === ctx && host.bootPromise) {
        return host.bootPromise
      }
      return Promise.reject(new Error(`[${this.name}] boot is already running with another context`))
    }

    if (host.state === 'ready' || host.state === 'building') {
      return host.bootContext === ctx
        ? Promise.resolve()
        : Promise.reject(new Error(`[${this.name}] reset is required before booting with another context`))
    }

    if (host.state === 'resetting') {
      return Promise.reject(new Error(`[${this.name}] boot is not available while reset is running`))
    }

    if (host.state === 'failed') {
      return Promise.reject(new Error(`[${this.name}] reset is required after a failed lifecycle`))
    }

    host.state = 'booting'
    host.bootContext = ctx
    host.lastError = null

    const bootPromise = this._runBoot(ctx, host)
    host.bootPromise = bootPromise

    return bootPromise
  }

  private static async _runBoot(ctx: EndgeFederationContext, host: EndgeFederationHost): Promise<void> {
    const touchedNodes = new Set<EndgeLifecycleNodeDescriptor>()

    try {
      await this.setup(ctx, touchedNodes)
      await this.load(ctx, touchedNodes)
      await this._buildPhase(ctx, touchedNodes)
      await this.start(ctx, touchedNodes)

      host.state = 'ready'
      host.isInitialized = true
    }
    catch (error) {
      host.lastError = error
      const rollbackErrors = await this._resetNodes(touchedNodes)

      host.isSetup = false
      host.isInitialized = false
      host.bootContext = null

      if (rollbackErrors.length > 0) {
        const lifecycleError = new AggregateError(
          [error, ...rollbackErrors],
          `[${this.name}] boot failed and rollback was incomplete`,
        )
        host.state = 'failed'
        host.lastError = lifecycleError
        throw lifecycleError
      }

      host.state = 'idle'
      throw error
    }
    finally {
      host.bootPromise = null
    }
  }

  /** Регистрирует декларативное расширение до configuration Federation. */
  public static use(plugin: EndgePlugin): void {
    const host = this._getOrCreateHost()

    if (host.isConfigured || host.isInitialized) {
      throw new Error(`[${this.name}] plugins must be registered before federation configuration`)
    }

    const pluginId = String(plugin?.id ?? '').trim()
    if (!pluginId) {
      throw new Error(`[${this.name}] plugin id is required`)
    }

    const modules = this._normalizeModuleDefinitions(plugin.modules ?? [])
    const federations = this._normalizeFederationDefinitions(plugin.federations ?? [])
    if (modules.length === 0 && federations.length === 0) {
      throw new Error(`[${this.name}] plugin "${pluginId}" must define modules or federations`)
    }

    const normalizedPlugin: EndgePlugin = { id: pluginId, modules, federations }
    const signature = this._createPluginSignature(normalizedPlugin)
    const existingSignature = host.pluginSignatures.get(pluginId)

    if (existingSignature) {
      if (existingSignature !== signature) {
        throw new Error(`[${this.name}] plugin "${pluginId}" has a conflicting definition`)
      }
      this._defineHostAccessors(host, modules, federations, true)
      return
    }

    this._validatePluginKeys(host, modules, federations)
    this._defineHostAccessors(host, modules, federations)
    host.plugins.push(normalizedPlugin)
    host.pluginSignatures.set(pluginId, signature)
  }

  /** Декларирует уже созданный Module во время custom configuration. */
  public static defineModule<T extends AnyEndgeModule>(descriptor: EndgeModuleDescriptor<T>): T {
    const host = this._requireConfiguringHost()
    const key = this._normalizeNodeKey(descriptor.key)
    if (!descriptor.module) {
      throw new Error(`[${this.name}] module "${key}" is required`)
    }
    this._assertNodeKeyAvailable(host, key)

    host.moduleDescriptors.push({ ...descriptor, key })
    return descriptor.module
  }

  public static defineModules(descriptors: readonly EndgeModuleDescriptor[]): void {
    for (const descriptor of descriptors) {
      this.defineModule(descriptor)
    }
  }

  /** Декларирует лениво создаваемые Modules во время configuration. */
  protected static defineModuleDefinitions(definitions: readonly EndgeModuleDefinition[]): void {
    const host = this._requireConfiguringHost()
    for (const definition of this._normalizeModuleDefinitions(definitions)) {
      this._assertNodeKeyAvailable(host, definition.key)
      host.moduleDefinitions.push(definition)
    }
  }

  /** Декларирует дочернюю Federation как composite lifecycle-узел. */
  public static defineFederation(definition: EndgeChildFederationDefinition): void {
    const host = this._requireConfiguringHost()
    const [normalized] = this._normalizeFederationDefinitions([definition])
    this._assertNodeKeyAvailable(host, normalized.key)
    host.federationDefinitions.push(normalized)
  }

  public static defineFederations(definitions: readonly EndgeChildFederationDefinition[]): void {
    for (const definition of definitions) {
      this.defineFederation(definition)
    }
  }

  protected static async setup(
    ctx: EndgeFederationContext = this._requireBootContext(),
    touchedNodes?: Set<EndgeLifecycleNodeDescriptor>,
  ): Promise<void> {
    const host = this.host
    if (host.isSetup) {
      return
    }

    await this._runPhase('setup', ctx, touchedNodes)
    host.isSetup = true
  }

  protected static async load(
    ctx: EndgeFederationContext = this._requireBootContext(),
    touchedNodes?: Set<EndgeLifecycleNodeDescriptor>,
  ): Promise<void> {
    await this._runPhase('load', ctx, touchedNodes)
  }

  public static build(ctx?: EndgeFederationContext): Promise<void> {
    const host = this._getOrCreateHost()
    if (host.parentFederationId) {
      return Promise.reject(new Error(
        `[${this.name}] lifecycle is managed by parent federation "${host.parentFederationId}"`,
      ))
    }

    this._ensureConfigured()
    const buildContext = ctx ?? host.bootContext
    if (!buildContext) {
      return Promise.reject(new Error(`[${this.name}] boot context is not available`))
    }
    if (host.bootContext !== buildContext) {
      return Promise.reject(new Error(`[${this.name}] build context differs from the active boot context`))
    }

    if (host.state !== 'ready' && host.state !== 'building') {
      return Promise.reject(new Error(`[${this.name}] build is not available in state "${host.state}"`))
    }

    host.state = 'building'
    host.pendingBuilds += 1

    const execution = host.buildQueue.then(() => this._buildPhase(buildContext))
    host.buildQueue = execution.then(() => undefined, () => undefined)

    return execution.then(
      () => {
        host.lastError = null
        this._finishBuild(host)
      },
      (error) => {
        host.lastError = error
        this._finishBuild(host)
        throw error
      },
    )
  }

  protected static async start(
    ctx: EndgeFederationContext = this._requireBootContext(),
    touchedNodes?: Set<EndgeLifecycleNodeDescriptor>,
  ): Promise<void> {
    await this._runPhase('start', ctx, touchedNodes)
  }

  /** Сбрасывает всё дерево в обратном dependency order. */
  public static reset(): Promise<void> {
    const host = this._getOrCreateHost()
    if (host.parentFederationId) {
      return Promise.reject(new Error(
        `[${this.name}] lifecycle is managed by parent federation "${host.parentFederationId}"`,
      ))
    }

    this._ensureConfigured()
    if (host.state === 'booting') {
      return Promise.reject(new Error(`[${this.name}] reset is not available while boot is running`))
    }

    if (host.state === 'resetting' && host.resetPromise) {
      return host.resetPromise
    }

    host.state = 'resetting'
    const resetPromise = this._runReset(host)
    host.resetPromise = resetPromise

    return resetPromise
  }

  private static async _runReset(host: EndgeFederationHost): Promise<void> {
    try {
      await host.buildQueue

      const resetErrors = await this._resetNodes(new Set(host.nodes))
      this._finishReset(host)

      if (resetErrors.length > 0) {
        const lifecycleError = new AggregateError(resetErrors, `[${this.name}] reset was incomplete`)
        host.state = 'failed'
        host.lastError = lifecycleError
        throw lifecycleError
      }

      host.state = 'idle'
      host.lastError = null
    }
    finally {
      host.resetPromise = null
    }
  }

  private static async _buildPhase(
    ctx: EndgeFederationContext,
    touchedNodes?: Set<EndgeLifecycleNodeDescriptor>,
  ): Promise<void> {
    await this._runPhase('build', ctx, touchedNodes)
  }

  private static async _runPhase(
    phase: EndgeFederationPhase,
    ctx: EndgeFederationContext,
    touchedNodes?: Set<EndgeLifecycleNodeDescriptor>,
  ): Promise<void> {
    for (const node of this.host.nodes) {
      touchedNodes?.add(node)
      try {
        if (node.kind === 'module') {
          await node.module[phase](ctx)
        }
        else {
          await this._getFederationControl(node.federation).runPhase(phase, ctx)
        }
      }
      catch (error) {
        throw new Error(
          `[${this.name}] Failed to ${phase} ${node.kind} "${node.key}": ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        )
      }
    }
  }

  private static async _resetNodes(touchedNodes: Set<EndgeLifecycleNodeDescriptor>): Promise<unknown[]> {
    const errors: unknown[] = []
    const nodes = this.host.nodes.filter(node => touchedNodes.has(node)).reverse()

    for (const node of nodes) {
      try {
        if (node.kind === 'module') {
          await node.module.reset()
        }
        else {
          await this._getFederationControl(node.federation).reset()
        }
      }
      catch (error) {
        errors.push(new Error(
          `[${this.name}] Failed to reset ${node.kind} "${node.key}": ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        ))
      }
    }

    return errors
  }

  private static _finishBuild(host: EndgeFederationHost): void {
    host.pendingBuilds -= 1
    if (host.pendingBuilds === 0 && host.state === 'building') {
      host.state = 'ready'
    }
  }

  private static _finishReset(host: EndgeFederationHost): void {
    host.isSetup = false
    host.isInitialized = false
    host.bootContext = null
    host.attachedTouchedNodes.clear()
  }

  public static getModule<T extends AnyEndgeModule = AnyEndgeModule>(key: string): T {
    const normalizedKey = String(key ?? '').trim()
    const module = this.host.modules.get(normalizedKey)

    if (!module) {
      throw new Error(`[${this.name}] module "${normalizedKey}" is not registered`)
    }

    return module as T
  }

  public static tryGetModule<T extends AnyEndgeModule = AnyEndgeModule>(key: string): T | null {
    const normalizedKey = String(key ?? '').trim()
    if (!normalizedKey) {
      return null
    }

    return (this.host.modules.get(normalizedKey) as T | undefined) ?? null
  }

  public static hasModule(key: string): boolean {
    const normalizedKey = String(key ?? '').trim()
    return normalizedKey ? this.host.modules.has(normalizedKey) : false
  }

  public static getFederation<T extends AnyEndgeFederation = AnyEndgeFederation>(key: string): T {
    const normalizedKey = String(key ?? '').trim()
    const federation = this.host.federations.get(normalizedKey)

    if (!federation) {
      throw new Error(`[${this.name}] federation "${normalizedKey}" is not registered`)
    }

    return federation as T
  }

  public static tryGetFederation<T extends AnyEndgeFederation = AnyEndgeFederation>(key: string): T | null {
    const normalizedKey = String(key ?? '').trim()
    if (!normalizedKey) {
      return null
    }

    return (this.host.federations.get(normalizedKey) as T | undefined) ?? null
  }

  public static hasFederation(key: string): boolean {
    const normalizedKey = String(key ?? '').trim()
    return normalizedKey ? this.host.federations.has(normalizedKey) : false
  }

  protected static get host(): EndgeFederationHost {
    this._ensureConfigured()
    return this._getOrCreateHost()
  }

  private static _ensureConfigured(): void {
    const host = this._getOrCreateHost()
    if (host.isConfigured) {
      return
    }
    if (host.isConfiguring) {
      throw new Error(`[${this.name}] circular federation configuration detected`)
    }

    host.isConfiguring = true
    host.moduleDefinitions = []
    host.federationDefinitions = []
    host.moduleDescriptors = []
    host.nodes = []
    host.modules.clear()
    host.federations.clear()
    try {
      this.configureFederation()
      this._installPlugins()
      this._finalizeNodes()
      host.isConfigured = true
    }
    catch (error) {
      host.isConfigured = false
      host.installedPluginIds.clear()
      throw error
    }
    finally {
      host.isConfiguring = false
    }
  }

  private static _getFederationId(): string {
    return String(this.federationId || this.name || 'default')
  }

  private static _createHost(): EndgeFederationHost {
    return {
      definitionSignature: null,
      parentFederationId: null,
      isConfigured: false,
      isConfiguring: false,
      isSetup: false,
      isInitialized: false,
      state: 'idle',
      lastError: null,
      bootContext: null,
      bootPromise: null,
      resetPromise: null,
      buildQueue: Promise.resolve(),
      pendingBuilds: 0,
      moduleDefinitions: [],
      federationDefinitions: [],
      moduleDescriptors: [],
      nodes: [],
      modules: new Map<string, AnyEndgeModule>(),
      federations: new Map<string, AnyEndgeFederation>(),
      facades: new Set<AnyEndgeFederation>(),
      plugins: [],
      pluginSignatures: new Map<string, string>(),
      installedPluginIds: new Set<string>(),
      attachedTouchedNodes: new Set<EndgeLifecycleNodeDescriptor>(),
    }
  }

  private static _getOrCreateHost(): EndgeFederationHost {
    const registry = EndgeFederation._registry()
    const federationId = this._getFederationId()

    let host = registry.get(federationId)
    if (!host) {
      host = EndgeFederation._createHost()
      registry.set(federationId, host)
    }

    this._normalizeHost(host)
    const signature = this.federationDefinitionSignature
    if (signature) {
      if (host.definitionSignature && host.definitionSignature !== signature) {
        throw new Error(`[${this.name}] federation id "${federationId}" has a conflicting definition`)
      }
      host.definitionSignature = signature
    }

    const facade = this as unknown as AnyEndgeFederation
    if (!host.facades.has(facade)) {
      for (const plugin of host.plugins) {
        this._defineAccessors(this, plugin.modules ?? [], plugin.federations ?? [], true)
      }
      host.facades.add(facade)
    }

    return host
  }

  private static _normalizeHost(host: EndgeFederationHost): void {
    host.definitionSignature ??= null
    host.parentFederationId ??= null
    host.isConfiguring ??= false
    host.state ??= host.isInitialized ? 'ready' : 'idle'
    host.lastError ??= null
    host.bootPromise ??= null
    host.resetPromise ??= null
    host.buildQueue ??= Promise.resolve()
    host.pendingBuilds ??= 0
    host.moduleDefinitions ??= []
    host.federationDefinitions ??= []
    host.moduleDescriptors ??= []
    host.nodes ??= []
    host.modules ??= new Map<string, AnyEndgeModule>()
    host.federations ??= new Map<string, AnyEndgeFederation>()
    host.facades ??= new Set<AnyEndgeFederation>()
    host.plugins ??= []
    host.pluginSignatures ??= new Map<string, string>()
    host.installedPluginIds ??= new Set<string>()
    host.attachedTouchedNodes ??= new Set<EndgeLifecycleNodeDescriptor>()
  }

  private static _normalizeModuleDefinitions(definitions: EndgeModuleDefinitions): EndgeModuleDefinition[] {
    const normalized: EndgeModuleDefinition[] = []
    const keys = new Set<string>()

    for (const definition of definitions) {
      const key = this._normalizeNodeKey(definition.key)
      if (keys.has(key)) {
        throw new Error(`[EndgeFederation.define] lifecycle node "${key}" is already defined`)
      }
      if (typeof definition.create !== 'function') {
        throw new TypeError(`[EndgeFederation.define] module factory "${key}" is required`)
      }

      keys.add(key)
      normalized.push({ ...definition, key })
    }

    return normalized
  }

  private static _normalizeFederationDefinitions(
    definitions: EndgeChildFederationDefinitions,
  ): EndgeChildFederationDefinition[] {
    const normalized: EndgeChildFederationDefinition[] = []
    const keys = new Set<string>()
    const federationIds = new Set<string>()

    for (const definition of definitions) {
      const key = this._normalizeNodeKey(definition.key)
      if (keys.has(key)) {
        throw new Error(`[EndgeFederation.define] lifecycle node "${key}" is already defined`)
      }
      const control = this._getFederationControl(definition.federation)
      if (federationIds.has(control.id)) {
        throw new Error(`[EndgeFederation.define] federation "${control.id}" is already attached`)
      }

      keys.add(key)
      federationIds.add(control.id)
      normalized.push({ ...definition, key })
    }

    return normalized
  }

  private static _normalizeNodeKey(value: string): string {
    const key = String(value ?? '').trim()
    if (!key) {
      throw new Error('[EndgeFederation] lifecycle node key is required')
    }
    return key
  }

  private static _requireBootContext(): EndgeFederationContext {
    const ctx = this.host.bootContext
    if (!ctx) {
      throw new Error(`[${this.name}] boot context is not available`)
    }

    return ctx
  }

  private static _requireConfiguringHost(): EndgeFederationHost {
    const host = this._getOrCreateHost()
    if (!host.isConfiguring) {
      throw new Error(`[${this.name}] lifecycle nodes can be defined only during federation configuration`)
    }
    return host
  }

  private static _assertNodeKeyAvailable(host: EndgeFederationHost, key: string): void {
    const exists = host.moduleDefinitions.some(item => item.key === key)
      || host.moduleDescriptors.some(item => item.key === key)
      || host.federationDefinitions.some(item => item.key === key)
    if (exists) {
      throw new Error(`[${this.name}] lifecycle node "${key}" is already defined`)
    }
  }

  private static _validatePluginKeys(
    host: EndgeFederationHost,
    modules: readonly EndgeModuleDefinition[],
    federations: readonly EndgeChildFederationDefinition[],
  ): void {
    const pluginKeys = [...modules.map(item => item.key), ...federations.map(item => item.key)]
    const local = new Set<string>()
    for (const key of pluginKeys) {
      if (local.has(key)) {
        throw new Error(`[${this.name}] plugin lifecycle node "${key}" is already defined`)
      }
      local.add(key)

      const registered = host.plugins.some(plugin =>
        plugin.modules?.some(item => item.key === key)
        || plugin.federations?.some(item => item.key === key),
      )
      if (registered) {
        throw new Error(`[${this.name}] plugin lifecycle node "${key}" is already registered`)
      }
    }
  }

  private static _installPlugins(): void {
    const host = this._getOrCreateHost()

    for (const plugin of host.plugins) {
      if (host.installedPluginIds.has(plugin.id)) {
        continue
      }

      this.defineModuleDefinitions(plugin.modules ?? [])
      this.defineFederations(plugin.federations ?? [])
      host.installedPluginIds.add(plugin.id)
    }
  }

  private static _finalizeNodes(): void {
    const host = this._getOrCreateHost()
    const definitionsByKey = new Map(host.moduleDefinitions.map(item => [item.key, item]))
    const descriptorsByKey = new Map(host.moduleDescriptors.map(item => [item.key, item]))
    const instances = new Map<string, AnyEndgeModule>()
    const creating = new Set<string>()
    const federationName = this.name

    const createModule = (key: string): AnyEndgeModule => {
      const normalizedKey = String(key ?? '').trim()
      const existing = instances.get(normalizedKey)
      if (existing) {
        return existing
      }

      const descriptor = descriptorsByKey.get(normalizedKey)
      if (descriptor) {
        instances.set(normalizedKey, descriptor.module)
        return descriptor.module
      }

      const definition = definitionsByKey.get(normalizedKey)
      if (!definition) {
        throw new Error(`[${federationName}] module factory references unknown module "${normalizedKey}"`)
      }
      if (creating.has(normalizedKey)) {
        throw new Error(`[${federationName}] circular module factory dependency: ${[...creating, normalizedKey].join(' -> ')}`)
      }

      creating.add(normalizedKey)
      try {
        const module = definition.create({
          getModule<T extends AnyEndgeModule = AnyEndgeModule>(moduleKey: string): T {
            return createModule(moduleKey) as T
          },
        })
        if (!module) {
          throw new Error(`[${federationName}] module factory "${normalizedKey}" returned no module`)
        }
        instances.set(normalizedKey, module)
        return module
      }
      finally {
        creating.delete(normalizedKey)
      }
    }

    const moduleNodes: EndgeLifecycleNodeDescriptor[] = [
      ...host.moduleDefinitions.map(definition => ({
        kind: 'module' as const,
        key: definition.key,
        module: createModule(definition.key),
        before: definition.before,
        after: definition.after,
      })),
      ...host.moduleDescriptors.map(descriptor => ({
        kind: 'module' as const,
        key: descriptor.key,
        module: createModule(descriptor.key),
        before: descriptor.before,
        after: descriptor.after,
      })),
    ]

    const attachedFederationIds = new Set<string>()
    const federationNodes: EndgeLifecycleNodeDescriptor[] = host.federationDefinitions.map((definition) => {
      const control = this._getFederationControl(definition.federation)
      if (attachedFederationIds.has(control.id)) {
        throw new Error(`[${this.name}] federation "${control.id}" is already attached`)
      }
      attachedFederationIds.add(control.id)
      return {
        kind: 'federation' as const,
        key: definition.key,
        federation: definition.federation,
        before: definition.before,
        after: definition.after,
      }
    })

    const nodes = sortEndgeOrderedDescriptors([...moduleNodes, ...federationNodes])
    host.nodes = nodes
    host.modules.clear()
    host.federations.clear()
    for (const node of nodes) {
      if (node.kind === 'module') {
        host.modules.set(node.key, node.module)
      }
      else {
        host.federations.set(node.key, node.federation)
      }
    }

    for (const node of nodes) {
      if (node.kind !== 'federation') {
        continue
      }

      const control = this._getFederationControl(node.federation)
      control.attach(this.id)
      control.configure()
    }
  }

  private static _defineAccessors(
    target: typeof EndgeFederation,
    modules: readonly EndgeModuleDefinition[],
    federations: readonly EndgeChildFederationDefinition[],
    allowKnownAccessor: boolean = false,
  ): void {
    for (const definition of modules) {
      this._assertAccessorAvailable(target, definition.key, allowKnownAccessor)
    }
    for (const definition of federations) {
      this._assertAccessorAvailable(target, definition.key, allowKnownAccessor)
    }

    for (const definition of modules) {
      this._defineAccessor(target, definition.key, 'module')
    }
    for (const definition of federations) {
      this._defineAccessor(target, definition.key, 'federation')
    }
  }

  private static _defineHostAccessors(
    host: EndgeFederationHost,
    modules: readonly EndgeModuleDefinition[],
    federations: readonly EndgeChildFederationDefinition[],
    allowKnownAccessor: boolean = false,
  ): void {
    const targets = [...host.facades] as unknown as Array<typeof EndgeFederation>
    for (const target of targets) {
      for (const definition of [...modules, ...federations]) {
        this._assertAccessorAvailable(target, definition.key, allowKnownAccessor)
      }
    }
    for (const target of targets) {
      this._defineAccessors(target, modules, federations, allowKnownAccessor)
    }
  }

  private static _assertAccessorAvailable(
    target: typeof EndgeFederation,
    key: string,
    allowKnownAccessor: boolean,
  ): void {
    if (!(key in target)) {
      return
    }
    if (allowKnownAccessor && Object.hasOwn(target, key)) {
      return
    }
    throw new Error(`[EndgeFederation.define] lifecycle node key "${key}" conflicts with federation API`)
  }

  private static _defineAccessor(
    target: typeof EndgeFederation,
    key: string,
    kind: EndgeLifecycleNodeDescriptor['kind'],
  ): void {
    if (Object.hasOwn(target, key)) {
      return
    }

    Object.defineProperty(target, key, {
      enumerable: true,
      get: function getLifecycleNode(this: typeof EndgeFederation): AnyEndgeModule | AnyEndgeFederation {
        return kind === 'module' ? this.getModule(key) : this.getFederation(key)
      },
    })
  }

  private static _createDefinitionSignature(
    modules: readonly EndgeModuleDefinition[],
    federations: readonly EndgeChildFederationDefinition[],
  ): string {
    return JSON.stringify({
      modules: modules.map(item => [item.key, toArray(item.before), toArray(item.after)]),
      federations: federations.map(item => [
        item.key,
        this._getFederationControl(item.federation).id,
        toArray(item.before),
        toArray(item.after),
      ]),
    })
  }

  private static _createPluginSignature(plugin: EndgePlugin): string {
    return JSON.stringify({
      modules: plugin.modules?.map(item => [item.key, toArray(item.before), toArray(item.after)]) ?? [],
      federations: plugin.federations?.map(item => [
        item.key,
        this._getFederationControl(item.federation).id,
        toArray(item.before),
        toArray(item.after),
      ]) ?? [],
    })
  }

  private static _getFederationControl(federation: AnyEndgeFederation): EndgeFederationControl {
    const controlFactory = (federation as unknown as Record<PropertyKey, unknown>)[ENDGE_FEDERATION_CONTROL_KEY]
    if (typeof controlFactory !== 'function') {
      throw new TypeError('[EndgeFederation] child federation uses an incompatible federation protocol')
    }
    return controlFactory.call(federation) as EndgeFederationControl
  }

  protected static [ENDGE_FEDERATION_CONTROL_KEY](): EndgeFederationControl {
    return {
      id: this.id,
      attach: parentFederationId => this._attachToParent(parentFederationId),
      configure: () => this._ensureConfigured(),
      runPhase: (phase, ctx) => this._runAttachedPhase(phase, ctx),
      reset: () => this._resetAttached(),
    }
  }

  private static _attachToParent(parentFederationId: string): void {
    const host = this._getOrCreateHost()
    let ancestorId: string | null = parentFederationId
    while (ancestorId) {
      if (ancestorId === this.id) {
        throw new Error(`[${this.name}] circular federation hierarchy contains "${this.id}"`)
      }
      ancestorId = this._registry().get(ancestorId)?.parentFederationId ?? null
    }

    if (host.parentFederationId && host.parentFederationId !== parentFederationId) {
      throw new Error(`[${this.name}] federation is already managed by parent "${host.parentFederationId}"`)
    }
    if (host.state !== 'idle') {
      throw new Error(`[${this.name}] federation must be idle before attaching to parent "${parentFederationId}"`)
    }

    host.parentFederationId = parentFederationId
  }

  private static async _runAttachedPhase(
    phase: EndgeFederationPhase,
    ctx: EndgeFederationContext,
  ): Promise<void> {
    const host = this.host

    if (phase === 'setup') {
      if (host.state !== 'idle') {
        throw new Error(`[${this.name}] attached boot is not available in state "${host.state}"`)
      }
      host.state = 'booting'
      host.bootContext = ctx
      host.lastError = null
      host.attachedTouchedNodes.clear()
    }
    else if (host.bootContext !== ctx) {
      throw new Error(`[${this.name}] attached lifecycle context differs from the active boot context`)
    }

    const isRebuild = phase === 'build' && host.state === 'ready'
    if (isRebuild) {
      host.state = 'building'
    }

    try {
      await this._runPhase(phase, ctx, host.attachedTouchedNodes)
      if (phase === 'setup') {
        host.isSetup = true
      }
      if (phase === 'start') {
        host.isInitialized = true
        host.state = 'ready'
      }
      else if (isRebuild) {
        host.state = 'ready'
      }
      host.lastError = null
    }
    catch (error) {
      host.lastError = error
      if (isRebuild) {
        host.state = 'ready'
      }
      throw error
    }
  }

  private static async _resetAttached(): Promise<void> {
    const host = this.host
    host.state = 'resetting'

    const touchedNodes = host.attachedTouchedNodes.size > 0
      ? new Set(host.attachedTouchedNodes)
      : new Set(host.nodes)
    const resetErrors = await this._resetNodes(touchedNodes)
    this._finishReset(host)

    if (resetErrors.length > 0) {
      const lifecycleError = new AggregateError(resetErrors, `[${this.name}] reset was incomplete`)
      host.state = 'failed'
      host.lastError = lifecycleError
      throw lifecycleError
    }

    host.state = 'idle'
    host.lastError = null
  }

  private static _registry(): Map<string, EndgeFederationHost> {
    const globalRegistry = globalThis as typeof globalThis & Record<string | symbol, unknown>

    if (!(ENDGE_FEDERATION_REGISTRY_KEY in globalRegistry)) {
      globalRegistry[ENDGE_FEDERATION_REGISTRY_KEY] = new Map<string, EndgeFederationHost>()
    }

    return globalRegistry[ENDGE_FEDERATION_REGISTRY_KEY] as Map<string, EndgeFederationHost>
  }
}
