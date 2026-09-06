import type {
  EndgeUISnapshot,
  TimeZoneMode,
} from '@/features/core/modules/ui/domain/types/ui.types'

import { Endge } from '@/features/core/kernel/endge'
import {
  ALL_THEME_CLASSES,
  THEME_CLASS_BY_NAME,
  themeConfig,
} from '@/features/core/modules/ui/domain/types/ui.types'
import { EndgeModule } from '@/features/federation/EndgeModule'

/**
 * UI-состояние ядра: zoom, theme и режим отображения времени.
 */
export class EndgeUI_Module extends EndgeModule {
  private _offContext: (() => void) | null = null
  private _offZoomState: (() => void) | null = null
  private _offWorkspace: (() => void) | null = null
  //
  // Настройки zoom
  private readonly _MIN_ZOOM: number = 50
  private readonly _MAX_ZOOM: number = 150
  private readonly _STEP_ZOOM: number = 25
  private readonly _DEFAULT_ZOOM: number = 100
  private readonly _ZOOM_STATE_KEY: string = 'endge.ui.zoom'
  private readonly _LEGACY_LS_KEY_ZOOM: string = 'zoom'

  // Состояние
  private _zoom: number
  private _theme: string

  /**
   * Создаёт UI-модуль с безопасными bootstrap defaults и применяет тему к document.
   */
  public constructor() {
    super()

    this._zoom = this._DEFAULT_ZOOM
    this._theme = themeConfig.defaultTheme

    // сразу применим (как immediate watch)
    this._applyThemeToDocument(this._theme)
  }

  /** Подключает UI projection к пользовательскому контексту после загрузки workspace. */
  public override start(): void {
    this._offContext?.()
    this._offZoomState?.()
    this._offWorkspace?.()
    this._offContext = Endge.context.subscribe(() => {
      const zoomChanged = this._syncZoomFromContext()
      const themeChanged = this._syncThemeFromContext()
      if (!zoomChanged && !themeChanged) {
        this.notify()
      }
    })
    this._offZoomState = Endge.context.subscribeState(this._ZOOM_STATE_KEY, () => {
      this._syncZoomFromContext()
    })
    this._offWorkspace = Endge.workspace.subscribe(() => {
      if (!this._syncThemeFromContext()) {
        this.notify()
      }
    })
    this._migrateLegacyZoom()
    this._syncZoomFromContext()
    this._syncThemeFromContext()
  }

  /** Отключает runtime subscription; пользовательское значение остаётся в EndgeContext_Module. */
  public override reset(): void {
    this._offContext?.()
    this._offZoomState?.()
    this._offWorkspace?.()
    this._offContext = null
    this._offZoomState = null
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

      isLocalTime: this.isLocalTime,
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
    const next: number = this._clampZoom(value)
    if (next === this._zoom) {
      return
    }

    this._zoom = next
    Endge.context.setState(this._ZOOM_STATE_KEY, next)
    this.notify()
  }

  /**
   * Возвращает zoom к значению по умолчанию.
   */
  public resetZoom(): void {
    this.setZoom(this._DEFAULT_ZOOM)
  }

  /**
   * Увеличивает zoom на один шаг.
   */
  public zoomUp(): void {
    if (this._zoom < this._MAX_ZOOM) {
      this.setZoom(this._zoom + this._STEP_ZOOM)
    }
  }

  /**
   * Уменьшает zoom на один шаг.
   */
  public zoomDown(): void {
    if (this._zoom > this._MIN_ZOOM) {
      this.setZoom(this._zoom - this._STEP_ZOOM)
    }
  }

  /**
   * Внутренний helper модуля: clamp Zoom.
   */
  private _clampZoom(value: number): number {
    const n: number = Math.round(Number(value))
    if (!Number.isFinite(n)) {
      return this._DEFAULT_ZOOM
    }
    return Math.min(this._MAX_ZOOM, Math.max(this._MIN_ZOOM, n))
  }

  private _syncZoomFromContext(): boolean {
    const next = this._clampZoom(
      Endge.context.getState<number>(this._ZOOM_STATE_KEY) ?? this._DEFAULT_ZOOM,
    )
    if (next === this._zoom) {
      return false
    }
    this._zoom = next
    this.notify()
    return true
  }

  /** Однократно переносит прежний глобальный zoom в user-scoped context state. */
  private _migrateLegacyZoom(): void {
    if (
      Endge.context.getState<number>(this._ZOOM_STATE_KEY) !== undefined
      || typeof localStorage === 'undefined'
    ) {
      return
    }
    try {
      const raw = localStorage.getItem(this._LEGACY_LS_KEY_ZOOM)
      if (raw == null) {
        return
      }
      Endge.context.setState(this._ZOOM_STATE_KEY, this._clampZoom(Number(raw)))
      if (Endge.context.getState(this._ZOOM_STATE_KEY) !== undefined) {
        localStorage.removeItem(this._LEGACY_LS_KEY_ZOOM)
      }
    }
    catch {
      // Legacy migration не должна блокировать UI lifecycle.
    }
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
    if (!Endge.workspace.isLoaded) {
      return [...themeConfig.availableThemes]
    }
    return Endge.workspace.themes.map(theme => theme.identity)
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
    if (!this.availableThemes.includes(identity)) {
      return
    }

    Endge.context.setCurrentTheme(identity)
    this._syncThemeFromContext()
  }

  private _syncThemeFromContext(): boolean {
    if (!Endge.workspace.isLoaded) {
      return false
    }

    const next = Endge.context.currentTheme
    if (next === this._theme) {
      return false
    }

    this._theme = next
    this._applyThemeToDocument(next)
    this.notify()
    return true
  }

  /**
   * Применяет Theme To Document.
   */
  private _applyThemeToDocument(theme: string): void {
    if (typeof document === 'undefined') {
      return
    }

    const root: HTMLElement = document.documentElement
    root.dataset.endgeTheme = theme
    root.classList.remove(...ALL_THEME_CLASSES)

    // на всякий случай: если theme сломан, не кидаем
    const cls: string[] | undefined = THEME_CLASS_BY_NAME[theme]
    if (cls?.length) {
      root.classList.add(...cls)
    }
  }

  //
  // Время
  //
  /**
   * Показывает, используется ли локальное время вместо UTC.
   */
  public get isLocalTime(): boolean {
    return Endge.context.currentTimezone !== 'UTC'
  }

  /**
   * Возвращает текущий режим времени для UI.
   */
  public get timeZone(): TimeZoneMode {
    return this.isLocalTime ? 'LT' : 'UTC'
  }

  /**
   * Явно выставить режим.
   */
  public setLocalTime(value: boolean): void {
    const timezone = value
      ? Endge.workspace.timezones.find(item => item.identity !== 'UTC')?.identity
      ?? Endge.workspace.defaultTimezone
      : Endge.workspace.supportsTimezone('UTC')
        ? 'UTC'
        : Endge.workspace.defaultTimezone
    Endge.context.setCurrentTimezone(timezone)
  }

  /**
   * Переключатель LT <-> UTC.
   */
  public switchTime(): void {
    this.setLocalTime(!this.isLocalTime)
  }
}
