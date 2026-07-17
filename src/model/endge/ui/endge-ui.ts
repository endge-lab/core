import type {
  EndgeUISnapshot,
  TimeZoneMode,
} from '@/domain/types/ui/ui.types'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { getActiveEndgeConfiguration, hasActiveEndgeWorkspace } from '@/model/config/endge-workspace'
import { Endge } from '@/model/endge/kernel/endge'
import {
  ALL_THEME_CLASSES,
  THEME_CLASS_BY_NAME,
  themeConfig,
} from '@/domain/types/ui/ui.types'

/**
 * UI-состояние ядра: zoom, theme и режим отображения времени.
 */
export class EndgeUI extends EndgeModule {
  private _offContext: (() => void) | null = null
  private _offWorkspace: (() => void) | null = null
  //
  // Настройки zoom
  private readonly MIN_ZOOM: number = 50
  private readonly MAX_ZOOM: number = 150
  private readonly STEP_ZOOM: number = 25
  private readonly DEFAULT_ZOOM: number = 100
  private readonly LS_KEY_ZOOM: string = 'zoom'

  //
  // Настройки времени
  // true означает локальное время (LT)
  // false означает UTC
  private readonly DEFAULT_IS_LOCAL_TIME: boolean = true
  private readonly LS_KEY_IS_LOCAL_TIME: string = 'endge:isLocalTime'

  // Состояние
  private _zoom: number
  private _theme: string
  private _isLocalTime: boolean

  /**
   * Восстанавливает UI-настройки из localStorage и применяет тему к document.
   */
  constructor() {
    super()

    this._zoom = this.readZoomFromLS()
    this._theme = themeConfig.defaultTheme
    this._isLocalTime = this.readIsLocalTimeFromLS()

    // сразу применим (как immediate watch)
    this.applyThemeToDocument(this._theme)
  }

  /** Подключает UI projection к пользовательскому контексту после загрузки workspace. */
  public override start(): void {
    this._offContext?.()
    this._offWorkspace?.()
    this._offContext = Endge.context.subscribe(() => this.syncThemeFromContext())
    this._offWorkspace = Endge.workspace.subscribe(() => {
      if (!this.syncThemeFromContext())
        this.notify()
    })
    this.syncThemeFromContext()
  }

  /** Отключает runtime subscription; пользовательское значение остаётся в EndgeContext. */
  public override reset(): void {
    this._offContext?.()
    this._offWorkspace?.()
    this._offContext = null
    this._offWorkspace = null
  }

  //
  // Снимок состояния
  //
  /**
   * Возвращает полный snapshot UI-настроек.
   */
  public get snapshot(): EndgeUISnapshot {
    return {
      zoom: this._zoom,
      zoomClass: this.zoomClass,
      theme: this._theme,
      isDark: this.isDark,

      isLocalTime: this._isLocalTime,
      timeZone: this.timeZone,
    }
  }

  //
  // Масштаб
  //
  /**
   * Возвращает текущий процент zoom.
   */
  public get zoom(): number {
    return this._zoom
  }

  /**
   * Возвращает CSS-класс текущего zoom.
   */
  public get zoomClass(): string {
    return `zoom-${this._zoom}`
  }

  /**
   * Устанавливает zoom с ограничением допустимого диапазона.
   */
  public setZoom(value: number): void {
    const next: number = this.clampZoom(value)
    if (next === this._zoom)
      return

    this._zoom = next
    this.writeZoomToLS(next)
    this.notify()
  }

  /**
   * Возвращает zoom к значению по умолчанию.
   */
  public resetZoom(): void {
    this.setZoom(this.DEFAULT_ZOOM)
  }

  /**
   * Увеличивает zoom на один шаг.
   */
  public zoomUp(): void {
    if (this._zoom < this.MAX_ZOOM)
      this.setZoom(this._zoom + this.STEP_ZOOM)
  }

  /**
   * Уменьшает zoom на один шаг.
   */
  public zoomDown(): void {
    if (this._zoom > this.MIN_ZOOM)
      this.setZoom(this._zoom - this.STEP_ZOOM)
  }

  /**
   * Внутренний helper модуля: clamp Zoom.
   */
  private clampZoom(value: number): number {
    const n: number = Math.round(Number(value))
    if (!Number.isFinite(n))
      return this.DEFAULT_ZOOM
    return Math.min(this.MAX_ZOOM, Math.max(this.MIN_ZOOM, n))
  }

  /**
   * Считывает Zoom From LS.
   */
  private readZoomFromLS(): number {
    if (typeof localStorage === 'undefined')
      return this.DEFAULT_ZOOM
    const raw: string | null = localStorage.getItem(this.LS_KEY_ZOOM)
    const n: number = raw == null ? this.DEFAULT_ZOOM : Number(raw)
    return this.clampZoom(n)
  }

  /**
   * Записывает Zoom To LS.
   */
  private writeZoomToLS(value: number): void {
    if (typeof localStorage === 'undefined')
      return
    localStorage.setItem(this.LS_KEY_ZOOM, String(value))
  }

  //
  // Тема
  //
  /**
   * Возвращает текущую тему.
   */
  public get theme(): string {
    return this._theme
  }

  /** Возвращает workspace theme catalog; до boot используется безопасный bootstrap fallback. */
  public get availableThemes(): string[] {
    if (!hasActiveEndgeWorkspace())
      return [...themeConfig.availableThemes]
    return getActiveEndgeConfiguration().themes.map(theme => theme.identity)
  }

  /**
   * Показывает, активна ли темная тема.
   */
  public get isDark(): boolean {
    return this._theme === 'dark'
  }

  /**
   * Устанавливает тему, сохраняет ее и применяет CSS-классы к document.
   */
  public setTheme(next: string): void {
    const identity = String(next ?? '').trim()
    if (!this.availableThemes.includes(identity))
      return

    Endge.context.setCurrentTheme(identity)
    this.syncThemeFromContext()
  }

  private syncThemeFromContext(): boolean {
    if (!hasActiveEndgeWorkspace())
      return false

    const next = Endge.context.currentTheme
    if (next === this._theme)
      return false

    this._theme = next
    this.applyThemeToDocument(next)
    this.notify()
    return true
  }

  /**
   * Применяет Theme To Document.
   */
  private applyThemeToDocument(theme: string): void {
    if (typeof document === 'undefined')
      return

    const root: HTMLElement = document.documentElement
    root.dataset.endgeTheme = theme
    root.classList.remove(...ALL_THEME_CLASSES)

    // на всякий случай: если theme сломан, не кидаем
    const cls: string[] | undefined = THEME_CLASS_BY_NAME[theme]
    if (cls?.length)
      root.classList.add(...cls)
  }

  //
  // Время
  //
  /**
   * Показывает, используется ли локальное время вместо UTC.
   */
  public get isLocalTime(): boolean {
    return this._isLocalTime
  }

  /**
   * Возвращает текущий режим времени для UI.
   */
  public get timeZone(): TimeZoneMode {
    return this._isLocalTime ? 'LT' : 'UTC'
  }

  /**
   * Явно выставить режим.
   */
  public setLocalTime(value: boolean): void {
    const next: boolean = Boolean(value)
    if (next === this._isLocalTime)
      return

    this._isLocalTime = next
    this.writeIsLocalTimeToLS(next)
    this.notify()
  }

  /**
   * Переключатель LT <-> UTC.
   */
  public switchTime(): void {
    this.setLocalTime(!this._isLocalTime)
  }

  /**
   * Считывает Is Local Time From LS.
   */
  private readIsLocalTimeFromLS(): boolean {
    if (typeof localStorage === 'undefined')
      return this.DEFAULT_IS_LOCAL_TIME

    const raw: string | null = localStorage.getItem(this.LS_KEY_IS_LOCAL_TIME)
    if (raw == null)
      return this.DEFAULT_IS_LOCAL_TIME

    // поддержим разные форматы ("true"/"false"/"1"/"0")
    const s: string = raw.trim().toLowerCase()
    if (s === 'true' || s === '1')
      return true
    if (s === 'false' || s === '0')
      return false

    return this.DEFAULT_IS_LOCAL_TIME
  }

  /**
   * Записывает Is Local Time To LS.
   */
  private writeIsLocalTimeToLS(value: boolean): void {
    if (typeof localStorage === 'undefined')
      return
    localStorage.setItem(this.LS_KEY_IS_LOCAL_TIME, value ? 'true' : 'false')
  }
}
