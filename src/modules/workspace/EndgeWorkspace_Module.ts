import type { EndgeBootContext } from '@/kernel/types/bootstrap.types'
import type { EndgeConfiguration } from '@/modules/configuration/domain/types/configuration.type'
import type {
  EndgeDataMode,
  EndgeWorkspaceDefinition,
  EndgeWorkspaceLocale,
  EndgeWorkspaceLocaleLabelMode,
  EndgeWorkspaceTheme,
  EndgeWorkspaceTimezone,
  EndgeWorkspaceVar,
} from '@/modules/workspace/domain/workspace.types'

import { Endge } from '@/kernel/endge'
import { EndgeModule } from '@/kernel/EndgeModule'
import { WorkspaceVariables } from '@/modules/context/endge-vars'
import { normalizeEndgeWorkspaceDefinition } from '@/modules/domain/entities/RWorkspace'

/**
 * Модуль workspace-профиля frontend-приложения.
 * Владеет workspace, загруженным из service-backend или release bundle.
 */
export class EndgeWorkspace_Module extends EndgeModule {
  private _current: EndgeWorkspaceDefinition | null = null
  public readonly variables = new WorkspaceVariables(() => this._configurationOrNull()?.vars ?? [])

  /** Сохраняет переопределения окружения до загрузки определения workspace. */
  public override setup(ctx: EndgeBootContext): void {
    this.variables.setEnvironment(ctx.vars)
  }

  /** Строит workspace из загруженного source. */
  public override build(ctx: EndgeBootContext): void {
    if (ctx.dataProvider === 'bundle') {
      const bundle = ctx.bundleSource
      if (!bundle) {
        throw new Error('[EndgeWorkspace] Workspace bundle is unavailable')
      }

      const workspace = bundle.workspace
      this.apply({
        ...workspace,
        dataMode: workspace.dataMode === 'development' ? 'mock' : 'live',
        installedIntegrations: bundle.installedIntegrations.map(integration => ({
          integrationId: integration.identity,
          integrationIdentity: integration.identity,
          version: integration.version,
        })),
      })
      return
    }

    if (ctx.dataProvider === 'default') {
      const snapshot = Endge.domainRepository.getLoadedSnapshot()
      if (!snapshot) {
        throw new Error('[EndgeWorkspace] live workspace snapshot is unavailable')
      }

      const { state: _serverState, ...workspace } = snapshot.workspace
      this.apply({
        ...workspace,
        dataMode: workspace.dataMode === 'development' ? 'mock' : 'live',
        installedIntegrations: snapshot.installedIntegrations.map(integration => ({
          integrationId: integration.identity,
          integrationIdentity: integration.identity,
          version: integration.version,
        })),
      })
      return
    }

    if (ctx.dataProvider === 'plain') {
      const identity = String(ctx.scope.workspaceIdentity ?? '').trim() || 'local'
      this.apply({
        identity,
        displayName: identity === 'local' ? 'Local workspace' : identity,
        dataMode: 'live',
        managedBy: 'user',
        managedById: null,
        meta: {},
        installedIntegrations: [],
        configuration: {},
      })
      return
    }

    throw new Error(`[EndgeWorkspace] Workspace cannot be loaded from ${ctx.dataProvider} provider`)
  }

  /** Очищает загруженный workspace. */
  public override reset(): void {
    this._current = null
    this.variables.setEnvironment({})
    Endge.context.setWorkspaceDataMode('live')
    this.notify()
  }

  /** Проверяет, поддерживает ли workspace указанную locale. */
  public supportsLocale(locale: string | null | undefined): boolean {
    const code = String(locale ?? '').trim()
    return this.locales.some(item => item.code === code)
  }

  /** Нормализует locale по правилам активного workspace. */
  public normalizeLocale(locale: string | null | undefined): string {
    const code = String(locale ?? '').trim()
    return this.supportsLocale(code) ? code : this.defaultLocale
  }

  /** Возвращает label locale в указанном режиме. */
  public getLocaleLabel(locale: string, mode: EndgeWorkspaceLocaleLabelMode = 'displayName'): string {
    return this.locales.find(item => item.code === locale)?.[mode] ?? locale
  }

  /** Проверяет, поддерживает ли workspace указанную тему. */
  public supportsTheme(theme: string | null | undefined): boolean {
    const identity = String(theme ?? '').trim()
    return this.themes.some(item => item.identity === identity)
  }

  /** Нормализует тему по правилам активного workspace. */
  public normalizeTheme(theme: string | null | undefined): string {
    const identity = String(theme ?? '').trim()
    return this.supportsTheme(identity) ? identity : this.defaultTheme
  }

  /** Возвращает пользовательское имя темы. */
  public getThemeLabel(theme: string): string {
    return this.themes.find(item => item.identity === theme)?.displayName ?? theme
  }

  /** Проверяет, поддерживает ли workspace указанную временную зону. */
  public supportsTimezone(timezone: string | null | undefined): boolean {
    const identity = String(timezone ?? '').trim()
    return this.timezones.some(item => item.identity === identity)
  }

  /** Нормализует временную зону по правилам активного workspace. */
  public normalizeTimezone(timezone: string | null | undefined): string {
    const identity = String(timezone ?? '').trim()
    return this.supportsTimezone(identity) ? identity : this.defaultTimezone
  }

  /** Возвращает пользовательское имя временной зоны. */
  public getTimezoneLabel(timezone: string): string {
    return this.timezones.find(item => item.identity === timezone)?.displayName ?? timezone
  }

  /** Применяет и публикует новую workspace-конфигурацию. */
  public apply(input: unknown): void {
    const next = normalizeEndgeWorkspaceDefinition(input)
    this._current = next
    Endge.context.setCurrentWorkspace(next.identity)
    Endge.context.setWorkspaceDataMode(next.dataMode)
    this.notify()
  }

  /** Сериализует текущую workspace-конфигурацию. */
  public override serialize(): EndgeWorkspaceDefinition {
    return this.current
  }

  /** Возвращает workspace или сообщает о нарушении boot lifecycle. */
  private _requireCurrent(): EndgeWorkspaceDefinition {
    if (!this._current) {
      throw new Error('[EndgeWorkspace] Workspace has not been loaded')
    }
    return this._current
  }

  /** Возвращает effective configuration после resolution и root configuration до него. */
  private _configurationOrNull(): EndgeConfiguration | null {
    try {
      if (Endge.configuration.isResolved) {
        return Endge.configuration.current
      }
    }
    catch {
      // Configuration module ещё не доступен на ранней workspace build-фазе.
    }
    return this._current?.configuration ?? null
  }

  private _configuration(): EndgeConfiguration {
    return this._configurationOrNull() ?? this._requireCurrent().configuration
  }

  /**
   * ACCESS
   */

  /** Показывает, загружен ли workspace. */
  public get isLoaded(): boolean {
    return this._current != null
  }

  /** Возвращает текущую нормализованную workspace-конфигурацию. */
  public get current(): EndgeWorkspaceDefinition {
    return this._requireCurrent()
  }

  /** Возвращает сохранённое значение по умолчанию, используемое при отсутствии локального runtime-переопределения. */
  public get dataMode(): EndgeDataMode {
    return this._requireCurrent().dataMode
  }

  /** Показывает, запускает ли workspace runtime с mock-данными по умолчанию. */
  public get isMockEnabled(): boolean {
    return this.dataMode === 'mock'
  }

  /** Возвращает доступные workspace locales. */
  public get locales(): EndgeWorkspaceLocale[] {
    return this._configuration().locales
  }

  /** Возвращает определения workspace variables. */
  public get vars(): EndgeWorkspaceVar[] {
    return this._configuration().vars
  }

  /** Явное имя для сохранённых определений переменных. */
  public get variableDefinitions(): EndgeWorkspaceVar[] {
    return this.vars
  }

  /** Возвращает locale по умолчанию. */
  public get defaultLocale(): string {
    return this._configuration().defaultLocale
  }

  /** Возвращает fallback locale. */
  public get fallbackLocale(): string {
    return this._configuration().fallbackLocale
  }

  /** Возвращает доступные workspace themes. */
  public get themes(): EndgeWorkspaceTheme[] {
    return this._configuration().themes
  }

  /** Возвращает тему по умолчанию. */
  public get defaultTheme(): string {
    return this._configuration().defaultTheme
  }

  /** Возвращает доступные workspace timezones. */
  public get timezones(): EndgeWorkspaceTimezone[] {
    return this._configuration().timezones
  }

  /** Возвращает временную зону по умолчанию. */
  public get defaultTimezone(): string {
    return this._configuration().defaultTimezone
  }

  /** Возвращает identity auth profile по умолчанию. */
  public get defaultAuthProfileIdentity(): string | null {
    return this._configuration().defaultAuthProfileIdentity
  }

  /** Возвращает список разрешённых SFC adapter ids. */
  public get sfcAdapterIds(): string[] {
    return this._configuration().sfcAdapterIds
  }

  /** Возвращает SFC adapter id по умолчанию. */
  public get defaultSfcAdapterId(): string {
    return this._configuration().defaultSfcAdapterId
  }
}
