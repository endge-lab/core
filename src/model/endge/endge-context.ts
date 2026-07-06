import { EndgeModule } from '@/domain/entities/endge/EndgeModule'

const LS_KEY = 'endge-context'

export interface EndgeContextSnapshot {
  project: string | null
  environment: string | null
  locale: string | null
}

/**
 * Контекст выполнения Endge: выбранный проект, среда и локаль.
 * Сериализация в localStorage через saveToStorage/loadFromStorage.
 */
export class EndgeContext extends EndgeModule {
  private _currentProject: string | null = null
  private _currentEnvironment: string | null = null
  private _currentLocale: string = 'en'
  private _isHydrating = false

  /**
   * Создает контекст и сразу пытается восстановить snapshot из localStorage.
   */
  constructor() {
    super()
    this.loadFromStorage()
  }

  /**
   * Показывает, идет ли сейчас восстановление контекста из localStorage.
   */
  get isLoadingFromStorage(): boolean {
    return this._isHydrating
  }

  /**
   * Возвращает сериализуемый snapshot выбранного проекта, окружения и локали.
   */
  public override serialize(): EndgeContextSnapshot {
    return {
      project: this._currentProject,
      environment: this._currentEnvironment,
      locale: this._currentLocale || null,
    }
  }

  /**
   * Восстанавливает контекст из snapshot или выставляет значения по умолчанию.
   */
  public override deserialize(payload: EndgeContextSnapshot | undefined): void {
    this._currentProject = payload?.project ?? null
    this._currentEnvironment = payload?.environment ?? 'dev'
    this._currentLocale = payload?.locale && ['en', 'ru'].includes(payload.locale) ? payload.locale : 'en'
  }

  /**
   * Сохраняет текущий контекст в localStorage.
   */
  saveToStorage(): void {
    if (this._isHydrating)
      return
    try {
      const out = this.serialize()
      if (typeof localStorage !== 'undefined')
        localStorage.setItem(LS_KEY, JSON.stringify(out))
    }
    catch {
      /* ignore */
    }
  }

  /**
   * Загружает snapshot контекста из localStorage и применяет его к модулю.
   */
  loadFromStorage(): EndgeContextSnapshot | undefined {
    this._isHydrating = true
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null
      const parsed = raw ? JSON.parse(raw) : undefined
      const obj = (parsed && typeof parsed === 'object') ? parsed : undefined
      this.deserialize(obj)
      return obj
    }
    catch {
      this.deserialize(undefined)
      return undefined
    }
    finally {
      queueMicrotask(() => {
        this._isHydrating = false
      })
    }
  }

  /**
   * Возвращает identity текущего проекта.
   */
  getCurrentProject(): string | null {
    return this._currentProject
  }

  /**
   * Устанавливает текущий проект и уведомляет подписчиков при изменении.
   */
  setCurrentProject(identity: string | null): void {
    const next = identity === '' ? null : identity
    if (next === this._currentProject)
      return
    this._currentProject = next
    this.saveToStorage()
    this.notify()
  }

  /**
   * Возвращает identity текущего окружения.
   */
  getCurrentEnvironment(): string {
    return this._currentEnvironment ?? 'dev'
  }

  /**
   * Устанавливает текущее окружение и сохраняет контекст.
   */
  setCurrentEnvironment(identity: string | null): void {
    const next = (identity === '' || identity == null) ? 'dev' : identity
    if (next === this._currentEnvironment)
      return
    this._currentEnvironment = next
    this.saveToStorage()
    this.notify()
  }

  /**
   * Возвращает текущую локаль интерфейса.
   */
  get currentLocale(): string {
    return this._currentLocale || 'en'
  }

  /**
   * Устанавливает текущую локаль с fallback на `en`.
   */
  set currentLocale(value: string) {
    const next = (value === 'ru' || value === 'en') ? value : 'en'
    if (next === this._currentLocale)
      return
    this._currentLocale = next
    this.saveToStorage()
    this.notify()
  }

  /**
   * Явно устанавливает текущую локаль через method-style API.
   */
  setCurrentLocale(locale: string | null): void {
    this.currentLocale = (locale === 'ru' || locale === 'en') ? locale : 'en'
  }
}
