import type {
  EndgeUISnapshot,
  TimeZoneMode,
} from '@/domain/types/ui.types'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import {
  ALL_THEME_CLASSES,
  THEME_CLASS_BY_NAME,
  themeConfig,
} from '@/domain/types/ui.types'

/**
 * UI-состояние ядра: zoom, theme и режим отображения времени.
 */
export class EndgeUI extends EndgeModule {
  //
  // ZOOM CONFIG
  private readonly MIN_ZOOM: number = 50
  private readonly MAX_ZOOM: number = 150
  private readonly STEP_ZOOM: number = 25
  private readonly DEFAULT_ZOOM: number = 100
  private readonly LS_KEY_ZOOM: string = 'zoom'

  //
  // TIME CONFIG
  // true => LT
  // false => UTC
  private readonly DEFAULT_IS_LOCAL_TIME: boolean = true
  private readonly LS_KEY_IS_LOCAL_TIME: string = 'endge:isLocalTime'

  // STATE
  private _zoom: number
  private _theme: string
  private _isLocalTime: boolean

  /**
   * Восстанавливает UI-настройки из localStorage и применяет тему к document.
   */
  constructor() {
    super()

    this._zoom = this.readZoomFromLS()
    this._theme = this.readThemeFromLS()
    this._isLocalTime = this.readIsLocalTimeFromLS()

    // сразу применим (как immediate watch)
    this.applyThemeToDocument(this._theme)
  }

  //
  // SNAPSHOT
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
  // ZOOM
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
  // THEME
  //
  /**
   * Возвращает текущую тему.
   */
  public get theme(): string {
    return this._theme
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
    if (!themeConfig.availableThemes.includes(next))
      return
    if (next === this._theme)
      return

    this._theme = next
    this.writeThemeToLS(next)
    this.applyThemeToDocument(next)
    this.notify()
  }

  /**
   * Считывает Theme From LS.
   */
  private readThemeFromLS(): string {
    if (typeof localStorage === 'undefined')
      return themeConfig.defaultTheme

    const raw: string | null = localStorage.getItem(themeConfig.storageKey)
    const v: string = raw ?? themeConfig.defaultTheme

    if (themeConfig.availableThemes.includes(v))
      return v

    return themeConfig.defaultTheme
  }

  /**
   * Записывает Theme To LS.
   */
  private writeThemeToLS(value: string): void {
    if (typeof localStorage === 'undefined')
      return
    localStorage.setItem(themeConfig.storageKey, value)
  }

  /**
   * Применяет Theme To Document.
   */
  private applyThemeToDocument(theme: string): void {
    if (typeof document === 'undefined')
      return

    const root: HTMLElement = document.documentElement
    root.classList.remove(...ALL_THEME_CLASSES)

    // на всякий случай: если theme сломан, не кидаем
    const cls: string[] | undefined = THEME_CLASS_BY_NAME[theme]
    if (cls?.length)
      root.classList.add(...cls)
  }

  //
  // TIME
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
