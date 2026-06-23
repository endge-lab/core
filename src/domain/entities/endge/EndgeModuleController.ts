export class EndgeModuleController {
  /** Зарегистрированные подмодули: ключ -> модуль */
  private _modules: Map<string, any> = new Map()

  /** Флаг инициализации контроллера */
  private _isInitialized = false

  /**
   * Регистрирует подмодуль
   */
  public registerModule(key: string, module: any): void {
    const k = String(key ?? '').trim()
    if (!k)
      throw new Error('[EndgeModuleController] module key is required')

    if (!module || typeof module.init !== 'function' || typeof module.reset !== 'function') {
      throw new Error(`[EndgeModuleController] module "${k}" must have init() and reset()`)
    }

    this._modules.set(k, module)
  }

  /**
   * Инициализация всех модулей
   */
  public init(): void {
    if (this._isInitialized)
      return

    for (const [key, mod] of this._modules.entries()) {
      try {
        mod.init?.()
      }
      catch (error) {
        console.warn(`[EndgeModuleController] Failed to init module "${key}":`, error)
      }
    }

    this._isInitialized = true
  }

  /**
   * Сброс состояния всех модулей
   */
  public reset(): void {
    for (const [key, mod] of this._modules.entries()) {
      try {
        mod.reset?.()
      }
      catch (error) {
        console.warn(`[EndgeModuleController] Failed to reset module "${key}":`, error)
      }
    }

    this._isInitialized = false
  }
}
