type EndgeFederationStage = 'setup' | 'init' | 'reset'

interface EndgeFederationLifecycleModule {
  setup?: () => void | Promise<void>
  init?: () => void | Promise<void>
  reset?: () => void | Promise<void>
  serialize?: () => unknown
  deserialize?: (payload: unknown) => void
}

export type EndgeFederationModule = object

interface EndgeFederationHost {
  isConfigured: boolean
  isSetup: boolean
  isInitialized: boolean
  isHydrating: boolean
  initPromise: Promise<void> | null
  modules: Map<string, EndgeFederationModule>
  state: Map<string, unknown>
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

  public static get isLoadingFromStorage(): boolean {
    return this.host.isHydrating
  }

  /**
   * Хук для одноразовой регистрации модулей в порядке вызова.
   */
  protected static configureFederation(): void {}

  /**
   * Регистрирует модуль в федерации.
   * Порядок регистрации определяет дальнейший порядок `setup/init/reset`.
   */
  public static registerModule<T extends EndgeFederationModule>(key: string, module: T): T {
    const normalizedKey = String(key ?? '').trim()
    if (!normalizedKey)
      throw new Error(`[${this.name}] module key is required`)
    if (!module || typeof module !== 'object')
      throw new Error(`[${this.name}] module "${normalizedKey}" must be an object`)

    this.host.modules.set(normalizedKey, module)
    return module
  }

  /**
   * Выполняет `setup()` для всех модулей один раз до первого `init()`.
   */
  public static async setup(): Promise<void> {
    const host = this.host
    if (host.isSetup)
      return

    await this.runLifecycle('setup')
    host.isSetup = true
  }

  /**
   * Общий guard для одноразовой инициализации федерации.
   */
  protected static async runInitialization(task: () => Promise<void>): Promise<void> {
    const host = this.host

    if (host.isInitialized)
      return

    if (host.initPromise)
      return await host.initPromise

    host.initPromise = (async () => {
      await task()
      host.isInitialized = true
    })()

    try {
      await host.initPromise
    }
    finally {
      host.initPromise = null
    }
  }

  /**
   * Выполняет `init()` для всех зарегистрированных модулей.
   */
  protected static async initModules(): Promise<void> {
    await this.runLifecycle('init')
  }

  /**
   * Выполняет `reset()` у всех модулей и сбрасывает состояние федерации.
   */
  protected static async resetModules(): Promise<void> {
    await this.runLifecycle('reset')

    const host = this.host
    host.isSetup = false
    host.isInitialized = false
    host.isHydrating = false
    host.initPromise = null
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
      const lifecycleModule = module as EndgeFederationLifecycleModule
      if (typeof lifecycleModule.serialize !== 'function')
        continue

      try {
        payload[key] = lifecycleModule.serialize()
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
        const lifecycleModule = module as EndgeFederationLifecycleModule
        if (typeof lifecycleModule.deserialize !== 'function')
          continue

        try {
          lifecycleModule.deserialize(payload[key])
        }
        catch {
          // ignore one broken module
        }
      }

      return payload
    }
    catch {
      for (const module of host.modules.values()) {
        const lifecycleModule = module as EndgeFederationLifecycleModule
        if (typeof lifecycleModule.deserialize !== 'function')
          continue

        try {
          lifecycleModule.deserialize(undefined)
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

  protected static getModule<T>(key: string): T {
    const normalizedKey = String(key ?? '').trim()
    const module = this.host.modules.get(normalizedKey)

    if (!module)
      throw new Error(`[${this.name}] module "${normalizedKey}" is not registered`)

    return module as T
  }

  protected static getState<T>(key: string, factory: () => T): T {
    const host = this.host

    if (!host.state.has(key))
      host.state.set(key, factory())

    return host.state.get(key) as T
  }

  protected static setState<T>(key: string, value: T): T {
    this.host.state.set(key, value)
    return value
  }

  protected static get host(): EndgeFederationHost {
    const registry = EndgeFederation.registry()
    const federationId = this.getFederationId()

    let host = registry.get(federationId)
    if (!host) {
      host = EndgeFederation.createHost()
      registry.set(federationId, host)
    }

    if (!host.isConfigured) {
      host.isConfigured = true
      try {
        this.configureFederation()
      }
      catch (error) {
        host.isConfigured = false
        throw error
      }
    }

    return host
  }

  private static async runLifecycle(stage: EndgeFederationStage): Promise<void> {
    for (const [key, module] of this.host.modules.entries()) {
      const action = (module as EndgeFederationLifecycleModule)[stage]
      if (typeof action !== 'function')
        continue

      try {
        await action.call(module)
      }
      catch (error) {
        console.warn(`[${this.name}] Failed to ${stage} module "${key}":`, error)
      }
    }
  }

  private static getFederationId(): string {
    return String(this.federationId || this.name || 'default')
  }

  private static createHost(): EndgeFederationHost {
    return {
      isConfigured: false,
      isSetup: false,
      isInitialized: false,
      isHydrating: false,
      initPromise: null,
      modules: new Map<string, EndgeFederationModule>(),
      state: new Map<string, unknown>(),
    }
  }

  private static registry(): Map<string, EndgeFederationHost> {
    const globalRegistry = globalThis as typeof globalThis & Record<string | symbol, unknown>

    if (!(this.REGISTRY_KEY in globalRegistry))
      globalRegistry[this.REGISTRY_KEY] = new Map<string, EndgeFederationHost>()

    return globalRegistry[this.REGISTRY_KEY] as Map<string, EndgeFederationHost>
  }
}
