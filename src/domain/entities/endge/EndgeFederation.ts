import type { EndgeBootContext } from '@/domain/types/bootstrap.types'
import type { EndgeModuleDescriptor, EndgePlugin } from '@/domain/types/endge-modules.types'
import type { EndgeFederationHost } from '@/domain/types/federation.types'

import type { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { sortEndgeModuleDescriptors } from '@/domain/entities/endge/sort-endge-modules'

function toArray(value: string | string[] | undefined): string[] {
  if (!value)
    return []
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

  private static readonly REGISTRY_KEY = Symbol.for('endge.federation.registry.v2')

  public static get isInitialized(): boolean {
    return this.host.isInitialized
  }

  public static get isConfigured(): boolean {
    return this.getOrCreateHost().isConfigured
  }

  public static get isLoadingFromStorage(): boolean {
    return this.host.isHydrating
  }

  /**
   * Хук для одноразовой регистрации модулей в порядке вызова.
   */
  protected static configureFederation(): void {}

  /**
   * Добавляет plugin в список расширений федерации.
   * Plugin устанавливается во время конфигурации федерации, до boot.
   */
  public static use(plugin: EndgePlugin): void {
    const host = this.getOrCreateHost()

    if (host.isConfigured || host.isInitialized)
      throw new Error(`[${this.name}] plugins must be registered before federation configuration`)

    const pluginId = String(plugin?.id ?? '').trim()
    if (!pluginId)
      throw new Error(`[${this.name}] plugin id is required`)
    if (typeof plugin.install !== 'function')
      throw new Error(`[${this.name}] plugin "${pluginId}" install() is required`)

    if (host.plugins.some(item => item.id === pluginId))
      return

    host.plugins.push(plugin)
  }

  /**
   * Декларирует модуль федерации.
   * Итоговый порядок строится после установки plugin-модулей.
   */
  public static defineModule<T extends EndgeModule>(descriptor: EndgeModuleDescriptor<T>): T {
    const host = this.getOrCreateHost()
    if (!host.isConfiguring)
      throw new Error(`[${this.name}] defineModule() can be used only during federation configuration`)

    const normalizedKey = String(descriptor.key ?? '').trim()
    if (!normalizedKey)
      throw new Error(`[${this.name}] module key is required`)
    if (!descriptor.module)
      throw new Error(`[${this.name}] module "${normalizedKey}" is required`)
    if (host.moduleDescriptors.some(item => item.key === normalizedKey))
      throw new Error(`[${this.name}] module "${normalizedKey}" is already defined`)

    const normalizedDescriptor: EndgeModuleDescriptor<T> = {
      ...descriptor,
      key: normalizedKey,
    }

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

  public static defineModules(descriptors: EndgeModuleDescriptor[]): void {
    for (const descriptor of descriptors)
      this.defineModule(descriptor)
  }

  /**
   * Выполняет `setup()` для всех модулей один раз до первого `start()`.
   */
  public static async setup(ctx: EndgeBootContext): Promise<void> {
    const host = this.host
    if (host.isSetup)
      return

    for (const [key, module] of host.modules.entries()) {
      try {
        await module.setup(ctx)
      }
      catch (error) {
        throw new Error(`[${this.name}] Failed to setup module "${key}": ${String(error)}`)
      }
    }

    host.isSetup = true
  }

  public static async load(ctx: EndgeBootContext): Promise<void> {
    for (const [key, module] of this.host.modules.entries()) {
      try {
        await module.load(ctx)
      }
      catch (error) {
        throw new Error(`[${this.name}] Failed to load module "${key}": ${String(error)}`)
      }
    }
  }

  public static async build(ctx: EndgeBootContext): Promise<void> {
    for (const [key, module] of this.host.modules.entries()) {
      try {
        await module.build(ctx)
      }
      catch (error) {
        throw new Error(`[${this.name}] Failed to build module "${key}": ${String(error)}`)
      }
    }
  }

  public static async start(ctx: EndgeBootContext): Promise<void> {
    for (const [key, module] of this.host.modules.entries()) {
      try {
        await module.start(ctx)
      }
      catch (error) {
        throw new Error(`[${this.name}] Failed to start module "${key}": ${String(error)}`)
      }
    }
  }

  /**
   * Выполняет `reset()` у всех модулей и сбрасывает состояние федерации.
   */
  public static async reset(): Promise<void> {
    for (const [key, module] of this.host.modules.entries()) {
      try {
        await module.reset()
      }
      catch (error) {
        console.warn(`[${this.name}] Failed to reset module "${key}":`, error)
      }
    }

    const host = this.host
    host.isSetup = false
    host.isInitialized = false
    host.isHydrating = false
  }

  /**
   * Сохраняет сериализуемое состояние всех модулей в storage федерации.
   */
  public static saveToStorage(): void {
    const storageKey = this.storageKey
    if (!storageKey || this.isLoadingFromStorage)
      return

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
      localStorage.setItem(storageKey, JSON.stringify(payload))
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
    if (!storageKey)
      return {}

    const host = this.host
    host.isHydrating = true

    try {
      const raw = localStorage.getItem(storageKey)
      const parsed = raw ? JSON.parse(raw) : {}
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
    finally {
      queueMicrotask(() => {
        host.isHydrating = false
      })
    }
  }

  public static getModule<T extends EndgeModule = EndgeModule>(key: string): T {
    const normalizedKey = String(key ?? '').trim()
    const module = this.host.modules.get(normalizedKey)

    if (!module)
      throw new Error(`[${this.name}] module "${normalizedKey}" is not registered`)

    return module as T
  }

  public static tryGetModule<T extends EndgeModule = EndgeModule>(key: string): T | null {
    const normalizedKey = String(key ?? '').trim()
    if (!normalizedKey)
      return null

    return (this.host.modules.get(normalizedKey) as T | undefined) ?? null
  }

  public static hasModule(key: string): boolean {
    const normalizedKey = String(key ?? '').trim()
    return normalizedKey ? this.host.modules.has(normalizedKey) : false
  }

  protected static get host(): EndgeFederationHost {
    const host = this.getOrCreateHost()

    if (!host.isConfigured) {
      host.isConfiguring = true
      host.moduleDescriptors = []
      host.modules.clear()
      try {
        this.configureFederation()
        this.installPlugins()
        this.finalizeModules()
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

  private static getFederationId(): string {
    return String(this.federationId || this.name || 'default')
  }

  private static createHost(): EndgeFederationHost {
    return {
      isConfigured: false,
      isConfiguring: false,
      isSetup: false,
      isInitialized: false,
      isHydrating: false,
      moduleDescriptors: [],
      modules: new Map<string, EndgeModule>(),
      plugins: [],
      installedPluginIds: new Set<string>(),
    }
  }

  private static getOrCreateHost(): EndgeFederationHost {
    const registry = EndgeFederation.registry()
    const federationId = this.getFederationId()

    let host = registry.get(federationId)
    if (!host) {
      host = EndgeFederation.createHost()
      registry.set(federationId, host)
    }

    return host
  }

  private static installPlugins(): void {
    const host = this.getOrCreateHost()

    for (const plugin of host.plugins) {
      if (host.installedPluginIds.has(plugin.id))
        continue

      plugin.install()
      host.installedPluginIds.add(plugin.id)
    }
  }

  private static finalizeModules(): void {
    const host = this.getOrCreateHost()
    const descriptors = sortEndgeModuleDescriptors(host.moduleDescriptors)

    host.modules.clear()
    for (const descriptor of descriptors)
      host.modules.set(descriptor.key, descriptor.module)
  }

  private static registry(): Map<string, EndgeFederationHost> {
    const globalRegistry = globalThis as typeof globalThis & Record<string | symbol, unknown>

    if (!(this.REGISTRY_KEY in globalRegistry))
      globalRegistry[this.REGISTRY_KEY] = new Map<string, EndgeFederationHost>()

    return globalRegistry[this.REGISTRY_KEY] as Map<string, EndgeFederationHost>
  }
}
