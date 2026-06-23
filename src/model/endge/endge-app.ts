import { EndgeModule } from '@/domain/entities/endge/EndgeModule'

const LS_KEY = 'endge-app'

export interface EndgeAppSnapshot {
  project: string | null
  environment: string | null
  /** Текущая локаль (ru, en и т.д.). Ссылка: Endge.app.currentLocale */
  locale: string | null
}

/**
 * Состояние приложения: выбранный проект и среда исполнения.
 * Сериализация в localStorage через saveToStorage/loadFromStorage.
 * serialize/deserialize опциональны - используются внутри save/load.
 */
export class EndgeApp extends EndgeModule {
  private _isDebug = false
  private _currentProject: string | null = null
  private _currentEnvironment: string | null = null
  /** Текущая локаль для всей админки/приложения. Доступ: Endge.app.currentLocale */
  private _currentLocale: string = 'en'
  private _isHydrating = false
  private _loadingCount = 0

  constructor() {
    super()
    this.loadFromStorage()
  }

  get isLoadingFromStorage(): boolean {
    return this._isHydrating
  }

  get isInitializing(): boolean {
    return this._loadingCount > 0
  }

  /** Сериализация состояния (опционально переопределяется). */
  serialize(): EndgeAppSnapshot {
    return {
      project: this._currentProject,
      environment: this._currentEnvironment,
      locale: this._currentLocale || null,
    }
  }

  /** Восстановление из payload (опционально переопределяется). undefined - сброс в дефолты. Окружение по умолчанию: dev. */
  deserialize(payload: EndgeAppSnapshot | undefined): void {
    this._currentProject = payload?.project ?? null
    this._currentEnvironment = payload?.environment ?? 'dev'
    this._currentLocale = payload?.locale && ['en', 'ru'].includes(payload.locale) ? payload.locale : 'en'
  }

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

  loadFromStorage(): EndgeAppSnapshot | undefined {
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

  // --- проект (фильтр виджета домена) ---

  getCurrentProject(): string | null {
    return this._currentProject
  }

  setCurrentProject(identity: string | null): void {
    const next = identity === '' ? null : identity
    if (next === this._currentProject)
      return
    this._currentProject = next
    this.saveToStorage()
    this.notify()
  }

  /** @deprecated Используйте getCurrentProject */
  getCurrent(): string | null {
    return this.getCurrentProject()
  }

  /** @deprecated Используйте setCurrentProject */
  setCurrent(identity: string | null): void {
    this.setCurrentProject(identity)
  }

  // --- среда исполнения ---

  getCurrentEnvironment(): string {
    return this._currentEnvironment ?? 'dev'
  }

  setCurrentEnvironment(identity: string | null): void {
    const next = (identity === '' || identity == null) ? 'dev' : identity
    if (next === this._currentEnvironment)
      return
    this._currentEnvironment = next
    this.saveToStorage()
    this.notify()
  }

  // --- локаль (для админки и приложений) ---

  /** Текущая локаль. Мок: en | ru. */
  get currentLocale(): string {
    return this._currentLocale || 'en'
  }

  set currentLocale(value: string) {
    const next = (value === 'ru' || value === 'en') ? value : 'en'
    if (next === this._currentLocale)
      return
    this._currentLocale = next
    this.saveToStorage()
    this.notify()
  }

  setCurrentLocale(locale: string | null): void {
    this.currentLocale = (locale === 'ru' || locale === 'en') ? locale : 'en'
  }

  beginLoading(): void {
    this._loadingCount += 1
    this.notify()
  }

  endLoading(): void {
    const next = Math.max(0, this._loadingCount - 1)
    if (next === this._loadingCount)
      return
    this._loadingCount = next
    this.notify()
  }

  async runLoading<T>(task: () => Promise<T>): Promise<T> {
    this.beginLoading()
    try {
      return await task()
    }
    finally {
      this.endLoading()
    }
  }

  get isDebug(): boolean {
    return this._isDebug
  }

  set isDebug(value: boolean) {
    this._isDebug = value
  }
}
