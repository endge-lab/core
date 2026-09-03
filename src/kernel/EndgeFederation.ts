import type { EndgeModule } from '@/kernel/EndgeModule'
import type { EndgeBootContext } from '@/kernel/types/bootstrap.types'
import type { EndgeModuleDescriptor, EndgePlugin } from '@/kernel/types/endge-modules.types'

import type { EndgeFederationHost, EndgeFederationState } from '@/kernel/types/federation.types'
import { ENDGE_FEDERATION_REGISTRY_KEY } from '@/kernel/constants/kernel.constants'
import { getEndgeFederationStorageAdapter } from '@/kernel/EndgeFederationStorage'
import { sortEndgeModuleDescriptors } from '@/kernel/sort-endge-modules'

type EndgeFederationPhase = 'setup' | 'load' | 'build' | 'start'

function toArray(value: string | string[] | undefined): string[] {
  if (!value) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

/**
 * Общая статическая федерация модулей.
 * Хост федерации живёт в `globalThis`, поэтому один и тот же класс
 * остаётся singleton даже при загрузке из разных пакетов/бандлов.
 */
export abstract class EndgeFederation {
  protected static readonly federationId: string = 'default'
  protected static readonly storageKey: string | null = null

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

  /**
   * Хук для одноразовой регистрации модулей в порядке вызова.
   */
  protected static configureFederation(): void {}

  /**
   * Запускает федерацию по полному lifecycle pipeline: `setup -> load -> build -> start`.
   */
  public static boot(ctx: EndgeBootContext): Promise<void> {
    const host = this.host

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

  private static async _runBoot(ctx: EndgeBootContext, host: EndgeFederationHost): Promise<void> {
    const touchedModules = new Set<EndgeModule>()

    try {
      await this.setup(ctx, touchedModules)
      await this.load(ctx, touchedModules)
      await this._buildPhase(ctx, touchedModules)
      await this.start(ctx, touchedModules)

      host.state = 'ready'
      host.isInitialized = true
    }
    catch (error) {
      host.lastError = error
      const rollbackErrors = await this._resetModules(touchedModules)

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

  /**
   * Добавляет plugin в список расширений федерации.
   * Plugin устанавливается во время конфигурации федерации, до boot.
   */
  public static use(plugin: EndgePlugin): void {
    const host = this._getOrCreateHost()

    if (host.isConfigured || host.isInitialized) {
      throw new Error(`[${this.name}] plugins must be registered before federation configuration`)
    }

    const pluginId = String(plugin?.id ?? '').trim()
    if (!pluginId) {
      throw new Error(`[${this.name}] plugin id is required`)
    }
    if (typeof plugin.install !== 'function') {
      throw new TypeError(`[${this.name}] plugin "${pluginId}" install() is required`)
    }

    if (host.plugins.some(item => item.id === pluginId)) {
      return
    }

    host.plugins.push(plugin)
  }

  /**
   * Декларирует модуль федерации.
   * Итоговый порядок строится после установки plugin-модулей.
   */
  public static defineModule<T extends EndgeModule>(descriptor: EndgeModuleDescriptor<T>): T {
    const host = this._getOrCreateHost()
    if (!host.isConfiguring) {
      throw new Error(`[${this.name}] defineModule() can be used only during federation configuration`)
    }

    const normalizedKey = String(descriptor.key ?? '').trim()
    if (!normalizedKey) {
      throw new Error(`[${this.name}] module key is required`)
    }
    if (!descriptor.module) {
      throw new Error(`[${this.name}] module "${normalizedKey}" is required`)
    }
    if (host.moduleDescriptors.some(item => item.key === normalizedKey)) {
      throw new Error(`[${this.name}] module "${normalizedKey}" is already defined`)
    }

    const normalizedDescriptor: EndgeModuleDescriptor<T> = {
      ...descriptor,
      key: normalizedKey,
    }

    //
    // Топологическая сортировка модулей
    const beforeIndex = toArray(descriptor.before)
      .map(target => host.moduleDescriptors.findIndex(item => item.key === target))
      .find(index => index >= 0)

    if (beforeIndex != null) {
      host.moduleDescriptors.splice(beforeIndex, 0, normalizedDescriptor)
      return descriptor.module
    }

    const afterIndex = toArray(descriptor.after)
      .map(target => host.moduleDescriptors.findIndex(item => item.key === target))
      .find(index => index >= 0)

    if (afterIndex != null) {
      host.moduleDescriptors.splice(afterIndex + 1, 0, normalizedDescriptor)
      return descriptor.module
    }

    host.moduleDescriptors.push(normalizedDescriptor)

    return descriptor.module
  }

  /**
   * Декларирует модули федерации.
   * Итоговый порядок строится после установки plugin-модулей.
   */
  public static defineModules(descriptors: EndgeModuleDescriptor[]): void {
    for (const descriptor of descriptors) {
      this.defineModule(descriptor)
    }
  }

  /**
   * Выполняет `setup()` для всех модулей один раз до первого `start()`.
   */
  protected static async setup(
    ctx: EndgeBootContext = this._requireBootContext(),
    touchedModules?: Set<EndgeModule>,
  ): Promise<void> {
    const host = this.host
    if (host.isSetup) {
      return
    }

    await this._runPhase('setup', ctx, touchedModules)

    host.isSetup = true
  }

  protected static async load(
    ctx: EndgeBootContext = this._requireBootContext(),
    touchedModules?: Set<EndgeModule>,
  ): Promise<void> {
    await this._runPhase('load', ctx, touchedModules)
  }

  public static build(ctx?: EndgeBootContext): Promise<void> {
    const host = this.host
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
    ctx: EndgeBootContext = this._requireBootContext(),
    touchedModules?: Set<EndgeModule>,
  ): Promise<void> {
    await this._runPhase('start', ctx, touchedModules)
  }

  /**
   * Выполняет `reset()` в обратном dependency order и сбрасывает состояние федерации.
   */
  public static reset(): Promise<void> {
    const host = this.host
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

      const resetErrors = await this._resetModules(new Set(host.modules.values()))
      host.isSetup = false
      host.isInitialized = false
      host.bootContext = null

      if (resetErrors.length > 0) {
        const lifecycleError = new AggregateError(
          resetErrors,
          `[${this.name}] reset was incomplete`,
        )
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
    ctx: EndgeBootContext,
    touchedModules?: Set<EndgeModule>,
  ): Promise<void> {
    await this._runPhase('build', ctx, touchedModules)
  }

  private static async _runPhase(
    phase: EndgeFederationPhase,
    ctx: EndgeBootContext,
    touchedModules?: Set<EndgeModule>,
  ): Promise<void> {
    for (const [key, module] of this.host.modules.entries()) {
      touchedModules?.add(module)
      try {
        await module[phase](ctx)
      }
      catch (error) {
        throw new Error(
          `[${this.name}] Failed to ${phase} module "${key}": ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        )
      }
    }
  }

  private static async _resetModules(touchedModules: Set<EndgeModule>): Promise<unknown[]> {
    const errors: unknown[] = []
    const modules = [...this.host.modules.entries()]
      .filter(([, module]) => touchedModules.has(module))
      .reverse()

    for (const [key, module] of modules) {
      try {
        await module.reset()
      }
      catch (error) {
        errors.push(new Error(
          `[${this.name}] Failed to reset module "${key}": ${error instanceof Error ? error.message : String(error)}`,
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

  /**
   * Сохраняет сериализуемое состояние всех модулей в storage федерации.
   */
  public static saveToStorage(): void {
    const storageKey = this.storageKey
    if (!storageKey) {
      return
    }

    const payload: Record<string, unknown> = {}

    for (const [key, module] of this.host.modules.entries()) {
      try {
        payload[key] = module.serialize()
      }
      catch {
        // ignore one broken module
      }
    }

    try {
      getEndgeFederationStorageAdapter()?.write(storageKey, payload)
    }
    catch {
      // ignore storage failures
    }
  }

  /**
   * Восстанавливает состояние модулей из storage федерации.
   */
  public static loadFromStorage(): Record<string, unknown> {
    const storageKey = this.storageKey
    if (!storageKey) {
      return {}
    }

    const host = this.host

    try {
      const parsed = getEndgeFederationStorageAdapter()?.read<unknown>(storageKey) ?? {}
      const payload = (parsed && typeof parsed === 'object') ? parsed as Record<string, unknown> : {}

      for (const [key, module] of host.modules.entries()) {
        try {
          module.deserialize(payload[key])
        }
        catch {
          // ignore one broken module
        }
      }

      return payload
    }
    catch {
      for (const module of host.modules.values()) {
        try {
          module.deserialize(undefined)
        }
        catch {
          // ignore one broken module
        }
      }

      return {}
    }
  }

  public static getModule<T extends EndgeModule = EndgeModule>(key: string): T {
    const normalizedKey = String(key ?? '').trim()
    const module = this.host.modules.get(normalizedKey)

    if (!module) {
      throw new Error(`[${this.name}] module "${normalizedKey}" is not registered`)
    }

    return module as T
  }

  public static tryGetModule<T extends EndgeModule = EndgeModule>(key: string): T | null {
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

  protected static get host(): EndgeFederationHost {
    const host = this._getOrCreateHost()

    if (!host.isConfigured) {
      host.isConfiguring = true
      host.moduleDescriptors = []
      host.modules.clear()
      try {
        this.configureFederation()
        this._installPlugins()
        this._finalizeModules()
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

    return host
  }

  private static _getFederationId(): string {
    return String(this.federationId || this.name || 'default')
  }

  private static _createHost(): EndgeFederationHost {
    return {
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
      moduleDescriptors: [],
      modules: new Map<string, EndgeModule>(),
      plugins: [],
      installedPluginIds: new Set<string>(),
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

    return host
  }

  private static _normalizeHost(host: EndgeFederationHost): void {
    host.state ??= host.isInitialized ? 'ready' : 'idle'
    host.lastError ??= null
    host.bootPromise ??= null
    host.resetPromise ??= null
    host.buildQueue ??= Promise.resolve()
    host.pendingBuilds ??= 0
  }

  private static _requireBootContext(): EndgeBootContext {
    const ctx = this.host.bootContext
    if (!ctx) {
      throw new Error(`[${this.name}] boot context is not available`)
    }

    return ctx
  }

  private static _installPlugins(): void {
    const host = this._getOrCreateHost()

    for (const plugin of host.plugins) {
      if (host.installedPluginIds.has(plugin.id)) {
        continue
      }

      plugin.install()
      host.installedPluginIds.add(plugin.id)
    }
  }

  private static _finalizeModules(): void {
    const host = this._getOrCreateHost()
    const descriptors = sortEndgeModuleDescriptors(host.moduleDescriptors)

    host.modules.clear()
    for (const descriptor of descriptors) {
      host.modules.set(descriptor.key, descriptor.module)
    }
  }

  private static _registry(): Map<string, EndgeFederationHost> {
    const globalRegistry = globalThis as typeof globalThis & Record<string | symbol, unknown>

    if (!(ENDGE_FEDERATION_REGISTRY_KEY in globalRegistry)) {
      globalRegistry[ENDGE_FEDERATION_REGISTRY_KEY] = new Map<string, EndgeFederationHost>()
    }

    return globalRegistry[ENDGE_FEDERATION_REGISTRY_KEY] as Map<string, EndgeFederationHost>
  }
}
