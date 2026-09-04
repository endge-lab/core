import type { EndgeBootContext } from '@/features/core/kernel/types/bootstrap.types'
import type { EndgeConfiguration } from '@/features/core/modules/configuration/domain/types/configuration.type'
import type {
  EndgeContextPersistenceConfig,
  EndgeContextSnapshot,
  EndgeKeyboardContextSnapshot,
  EndgePersistedContextSnapshot,
  EndgePersistenceOptions,
  EndgePersistenceScope,
  EndgeRuntimeContextSnapshot,
  EndgeSessionIdentityProvider,
  EndgeStorageAdapter,
} from '@/features/core/modules/context/domain/context-persistence.types'
import type { EndgePersistenceInput } from '@/features/core/modules/context/persistence/EndgeStorageAdapterRegistry'
import type {
  EndgeExecutionContext,
  EndgeExecutionContextResolutionInput,
} from '@/features/core/modules/runtime/domain/execution-context.types'

import type { EndgeDataMode } from '@/features/core/modules/workspace/domain/workspace.types'
import { Raph } from '@endge/raph'
import {
  CONTEXT_STORAGE_KEY,
  DEFAULT_LOCALE,
  DEFAULT_SCOPE,
  DEFAULT_THEME,
  DEFAULT_TIMEZONE,
  ENDGE_CONTEXT_RAPH_PATH,
  ENDGE_KEYBOARD_CONTEXT_RAPH_PATH,
  LEGACY_CONTEXT_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  LEGACY_TIMEZONE_STORAGE_KEY,
} from '@/features/core/kernel/config/kernel.config'
import { Endge } from '@/features/core/kernel/endge'
import { createEndgePublicConfigurationSnapshot } from '@/features/core/modules/configuration/domain/endge-configuration'
import { DisabledContextAdapter } from '@/features/core/modules/context/persistence/adapters/DisabledContextAdapter'
import { LocalStorageContextAdapter } from '@/features/core/modules/context/persistence/adapters/LocalStorageContextAdapter'
import {

  EndgeStorageAdapterRegistry,
  normalizePersistence,
} from '@/features/core/modules/context/persistence/EndgeStorageAdapterRegistry'
import { RuntimeStateController } from '@/features/core/modules/context/persistence/RuntimeStateController'
import { EndgeModule } from '@/features/federation/EndgeModule'

const THEME_PREFERENCE_VERSION = 1 as const
const LEGACY_STORAGE_ADAPTER = new LocalStorageContextAdapter()

/**
 * Контекст выполнения Endge: текущий workspace/project/environment/user scope
 * и координатор persistence-инфраструктуры приложения.
 */
export class EndgeContext_Module extends EndgeModule<EndgeBootContext> {
  private readonly _adapters = new EndgeStorageAdapterRegistry()
  private readonly _runtimeControllers = new Map<string, RuntimeStateController>()

  private _contextPersistence: EndgePersistenceOptions = { driver: 'local' }
  private _currentWorkspace: string | null = null
  private _currentTenant: string = DEFAULT_SCOPE.tenantId
  private _currentProject: string = DEFAULT_SCOPE.projectId
  private _currentEnvironment: string = DEFAULT_SCOPE.environmentId
  private _currentUser: string = DEFAULT_SCOPE.userId
  private _currentLocale = DEFAULT_LOCALE
  private _pendingLocale: string | null = null
  private _currentTheme = DEFAULT_THEME
  private _themePreference: string | null = null
  private _currentTimezone = DEFAULT_TIMEZONE
  private _pendingTimezone: string | null = null
  private _workspaceDataMode: EndgeDataMode = 'live'
  private _dataModeOverride: EndgeDataMode | null = null
  private _sessionProvider: EndgeSessionIdentityProvider | null = null
  private _isHydrating = false
  private _executionContextLocked = false

  /** Создаёт контекст, регистрирует storage adapters и восстанавливает snapshot. */
  public constructor() {
    super()
    this.registerStorageAdapter(new LocalStorageContextAdapter())
    this.registerStorageAdapter(new DisabledContextAdapter())
    this.loadFromStorage()
  }

  /** Применяет explicit structural context до load/build остальных модулей. */
  public override setup(ctx: EndgeBootContext): void {
    this._executionContextLocked = false
    const input = ctx.context
    if (input) {
      if (input.tenantIdentity != null) {
        this._currentTenant = normalizeScopePart(input.tenantIdentity, DEFAULT_SCOPE.tenantId)
      }
      if (input.projectIdentity != null) {
        this._currentProject = normalizeScopePart(input.projectIdentity, DEFAULT_SCOPE.projectId)
      }
      if (input.environmentIdentity != null) {
        this._currentEnvironment = normalizeScopePart(input.environmentIdentity, DEFAULT_SCOPE.environmentId)
      }
    }
    this._executionContextLocked = true
    this._syncPersistentContextToRaph()
  }

  /** Разрешает выбрать новый structural context только перед следующим boot. */
  public override reset(): void {
    this._executionContextLocked = false
    this.notify()
  }

  /** Показывает, выполняется ли восстановление контекста из storage. */
  public get isLoadingFromStorage(): boolean {
    return this._isHydrating
  }

  /** Регистрирует storage adapter для persistence-контекста. */
  public registerStorageAdapter(adapter: EndgeStorageAdapter): void {
    this._adapters.register(adapter)
  }

  /** Настраивает persistence текущего контекста. */
  public configurePersistence(config: EndgeContextPersistenceConfig): void {
    if (config.context == null) {
      return
    }

    this._contextPersistence = normalizePersistence(config.context)
    this.saveToStorage()
  }

  /** Устанавливает provider актуальных tenant и user identity. */
  public setSessionIdentityProvider(provider: EndgeSessionIdentityProvider | null): void {
    this._sessionProvider = provider
    this.notify()
  }

  /** Показывает, что Tenant принудительно задан authenticated session provider. */
  public get isTenantLockedBySession(): boolean {
    return normalizeOptionalText(this._sessionProvider?.getCurrentIdentity()?.tenantId) != null
  }

  /** Сериализует текущий execution scope в snapshot. */
  public override serialize(): EndgeContextSnapshot {
    return {
      workspace: this._currentWorkspace,
      tenant: this._currentTenant,
      project: this._currentProject,
      environment: this._currentEnvironment,
      user: this._currentUser,
      locale: this._currentLocale || null,
      theme: this._currentTheme || null,
      timezone: this._currentTimezone || null,
    }
  }

  /** Возвращает полный доступный SFC контекст без добавления временных значений в persistence. */
  public runtimeSnapshot(): EndgeRuntimeContextSnapshot {
    return {
      ...this.serialize(),
      config: createEndgePublicConfigurationSnapshot(Endge.configuration.current),
      input: {
        keyboard: this.getKeyboardState(),
      },
    }
  }

  /** Возвращает текущее временное состояние клавиатуры из общего пространства контекста Raph. */
  public getKeyboardState(): EndgeKeyboardContextSnapshot {
    return normalizeKeyboardContextSnapshot(Raph.get(ENDGE_KEYBOARD_CONTEXT_RAPH_PATH))
  }

  /** Публикует состояние клавиатуры UI-адаптера как узкие несохраняемые изменения Raph. */
  public setKeyboardState(input: EndgeKeyboardContextSnapshot): void {
    const next = normalizeKeyboardContextSnapshot(input)
    const current = this.getKeyboardState()
    Raph.transaction(() => {
      this._setRaphValueIfChanged(`${ENDGE_KEYBOARD_CONTEXT_RAPH_PATH}.platform`, current.platform, next.platform)
      for (const key of ['ctrl', 'shift', 'alt', 'meta', 'mod', 'altGraph'] as const) {
        this._setRaphValueIfChanged(
          `${ENDGE_KEYBOARD_CONTEXT_RAPH_PATH}.modifiers.${key}`,
          current.modifiers[key],
          next.modifiers[key],
        )
      }
      this._setRaphValueIfChanged(`${ENDGE_KEYBOARD_CONTEXT_RAPH_PATH}.held.key`, current.held.key, next.held.key)
      this._setRaphValueIfChanged(`${ENDGE_KEYBOARD_CONTEXT_RAPH_PATH}.held.code`, current.held.code, next.held.code)
    })
  }

  /** Сохраняет подписчиков legacy-модуля и проецирует постоянные поля контекста в Raph. */
  public override notify(): void {
    this._syncPersistentContextToRaph()
    super.notify()
  }

  /** Восстанавливает execution scope из snapshot с безопасными defaults. */
  public override deserialize(payload: Partial<EndgeContextSnapshot> | undefined): void {
    this._currentWorkspace = normalizeOptionalText(payload?.workspace)
    this._currentTenant = normalizeScopePart(payload?.tenant, DEFAULT_SCOPE.tenantId)
    this._currentProject = normalizeScopePart(payload?.project, DEFAULT_SCOPE.projectId)
    this._currentEnvironment = normalizeScopePart(payload?.environment, DEFAULT_SCOPE.environmentId)
    this._currentUser = normalizeScopePart(payload?.user, DEFAULT_SCOPE.userId)
    const rawLocale = normalizeOptionalText(payload?.locale)
    const rawTheme = normalizeOptionalText(payload?.theme) ?? readLegacyThemePreference()
    const rawTimezone = normalizeOptionalText(payload?.timezone) ?? readLegacyTimezonePreference()
    this._dataModeOverride = null
    this._currentLocale = rawLocale ?? DEFAULT_LOCALE
    this._pendingLocale = rawLocale ?? DEFAULT_LOCALE
    this._currentTheme = rawTheme ?? DEFAULT_THEME
    this._themePreference = rawTheme
    this._currentTimezone = rawTimezone ?? DEFAULT_TIMEZONE
    this._pendingTimezone = rawTimezone ?? DEFAULT_TIMEZONE
    this._syncPersistentContextToRaph()
  }

  /** Сохраняет текущий context snapshot через выбранный adapter. */
  public saveToStorage(): void {
    if (this._isHydrating) {
      return
    }

    try {
      this._resolveAdapter(this._contextPersistence).write(CONTEXT_STORAGE_KEY, this._serializeForPersistence())
    }
    catch (error) {
      console.warn(`[EndgeContext] Failed to persist context: ${error instanceof Error ? error.message : String(error)}`)
      /* Ошибка storage не должна прерывать работу контекста. */
    }
  }

  /** Загружает context snapshot из нового или legacy storage key. */
  public loadFromStorage(): EndgeContextSnapshot | undefined {
    let shouldPersistThemeMigration = false
    this._isHydrating = true
    try {
      const adapter = this._resolveAdapter(this._contextPersistence)
      const snapshot = adapter.read<EndgePersistedContextSnapshot>(CONTEXT_STORAGE_KEY)
        ?? adapter.read<EndgePersistedContextSnapshot>(LEGACY_CONTEXT_STORAGE_KEY)

      // Старые snapshots контекста сохраняли запасное bootstrap-значение так, будто оно было
      // выбрано пользователем. Только старый отдельный ключ темы может подтвердить явный
      // legacy-выбор; в остальных случаях значением владеет фактическая конфигурация.
      shouldPersistThemeMigration = snapshot != null
        && snapshot.themePreferenceVersion !== THEME_PREFERENCE_VERSION
      const migratedSnapshot = shouldPersistThemeMigration && snapshot
        ? { ...snapshot, theme: readLegacyThemePreference() }
        : snapshot

      this.deserialize(migratedSnapshot)
      return this.serialize()
    }
    catch {
      this.deserialize(undefined)
      return undefined
    }
    finally {
      queueMicrotask(() => {
        this._isHydrating = false
        if (shouldPersistThemeMigration) {
          this.saveToStorage()
        }
      })
    }
  }

  /** Возвращает полный persistence scope текущей сессии. */
  public getPersistenceScope(): EndgePersistenceScope {
    const session = this._resolveSessionIdentity()

    return {
      workspaceId: this._requireCurrentWorkspace(),
      tenantId: session.tenantId,
      projectId: this._currentProject,
      environmentId: this._currentEnvironment,
      userId: session.userId,
    }
  }

  /** Создаёт или возвращает controller runtime-состояния по runtime id. */
  public createRuntimeStateController(input: {
    runtimeId: string
    storageId?: string
    persistence?: EndgePersistenceInput
  }): RuntimeStateController {
    const runtimeId = normalizeRequiredScopePart(input.runtimeId, 'runtimeId')
    const existing = this._runtimeControllers.get(runtimeId)
    if (existing) {
      return existing
    }

    const persistence = normalizePersistence(input.persistence ?? { driver: 'local' })
    const controller = new RuntimeStateController({
      runtimeId,
      storageId: input.storageId,
      scope: () => persistence.driver === 'disabled'
        ? this._getDisabledPersistenceScope()
        : this.getPersistenceScope(),
      adapter: this._resolveAdapter(persistence),
    })
    this._runtimeControllers.set(runtimeId, controller)
    return controller
  }

  /** Возвращает runtime state controller по id. */
  public getRuntimeStateController(runtimeId: string): RuntimeStateController | null {
    return this._runtimeControllers.get(String(runtimeId ?? '').trim()) ?? null
  }

  /** Удаляет runtime state controller из registry. */
  public destroyRuntimeStateController(runtimeId: string): void {
    this._runtimeControllers.delete(String(runtimeId ?? '').trim())
  }

  /** Возвращает identity текущего workspace. */
  public getCurrentWorkspace(): string | null {
    return this._currentWorkspace
  }

  /** Устанавливает текущий workspace и сохраняет контекст. */
  public setCurrentWorkspace(identity: string | null): void {
    const next = normalizeOptionalText(identity)
    if (next === this._currentWorkspace) {
      return
    }

    this._currentWorkspace = next
    this._dataModeOverride = null
    this.saveToStorage()
    this.notify()
  }

  /** Возвращает identity текущего tenant с учётом session provider. */
  public getCurrentTenant(): string {
    return this._resolveSessionIdentity().tenantId
  }

  /** Устанавливает fallback identity текущего tenant. */
  public setCurrentTenant(identity: string | null): void {
    this._assertStructuralContextMutable('_currentTenant', identity, DEFAULT_SCOPE.tenantId)
    this._setScopeValue('_currentTenant', identity, DEFAULT_SCOPE.tenantId)
  }

  /** Возвращает identity текущего project. */
  public getCurrentProject(): string {
    return this._currentProject
  }

  /** Устанавливает текущий project и сохраняет контекст. */
  public setCurrentProject(identity: string | null): void {
    this._assertStructuralContextMutable('_currentProject', identity, DEFAULT_SCOPE.projectId)
    this._setScopeValue('_currentProject', identity, DEFAULT_SCOPE.projectId)
  }

  /** Возвращает identity текущего environment. */
  public getCurrentEnvironment(): string {
    return this._currentEnvironment
  }

  /** Возвращает immutable structural coordinates текущего boot lifecycle. */
  public getExecutionContext(): EndgeExecutionContext {
    return {
      tenantIdentity: this.getCurrentTenant(),
      projectIdentity: this.getCurrentProject(),
      environmentIdentity: this.getCurrentEnvironment(),
    }
  }

  /**
   * Разрешает structural context после загрузки Domain, но до configuration/build.
   * Explicit и session coordinates обязательны; сохранённые preferences могут
   * безопасно перейти на первую доступную сущность, если Domain изменился.
   */
  public resolveExecutionContext(input: EndgeExecutionContextResolutionInput): EndgeExecutionContext {
    const tenants = normalizeIdentityList(input.tenants)
    const projects = input.projects.filter(item => normalizeOptionalText(item.identity) != null)
    const sessionTenant = normalizeOptionalText(this._sessionProvider?.getCurrentIdentity()?.tenantId)
    const explicitTenant = normalizeOptionalText(input.explicit?.tenantIdentity)
    const explicitProject = normalizeOptionalText(input.explicit?.projectIdentity)
    const explicitEnvironment = normalizeOptionalText(input.explicit?.environmentIdentity)

    const tenantIdentity = resolveAvailableIdentity({
      label: 'Tenant',
      requested: sessionTenant ?? explicitTenant ?? this._currentTenant,
      required: sessionTenant != null || explicitTenant != null,
      available: tenants,
      fallbackWhenEmpty: DEFAULT_SCOPE.tenantId,
    })
    const projectIdentity = resolveAvailableIdentity({
      label: 'Project',
      requested: explicitProject ?? this._currentProject,
      required: explicitProject != null,
      available: projects.map(item => item.identity),
    })
    const project = projects.find(item => item.identity === projectIdentity)!
    const allowedEnvironmentIds = new Set(project.allowedEnvironmentIds.map(Number))
    const environments = input.environments
      .filter(item => normalizeOptionalText(item.identity) != null)
      .filter(item => allowedEnvironmentIds.size === 0 || allowedEnvironmentIds.has(Number(item.id)))
    const environmentIdentity = resolveAvailableIdentity({
      label: `Environment for Project "${projectIdentity}"`,
      requested: explicitEnvironment ?? this._currentEnvironment,
      required: explicitEnvironment != null,
      available: environments.map(item => item.identity),
    })

    const changed = tenantIdentity !== this._currentTenant
      || projectIdentity !== this._currentProject
      || environmentIdentity !== this._currentEnvironment

    this._currentTenant = tenantIdentity
    this._currentProject = projectIdentity
    this._currentEnvironment = environmentIdentity
    this.saveToStorage()

    if (changed) {
      this.notify()
    }

    return this.getExecutionContext()
  }

  /** Устанавливает текущий environment и сохраняет контекст. */
  public setCurrentEnvironment(identity: string | null): void {
    this._assertStructuralContextMutable('_currentEnvironment', identity, DEFAULT_SCOPE.environmentId)
    this._setScopeValue('_currentEnvironment', identity, DEFAULT_SCOPE.environmentId)
  }

  /** Возвращает identity текущего user с учётом session provider. */
  public getCurrentUser(): string {
    return this._resolveSessionIdentity().userId
  }

  /** Устанавливает fallback identity текущего user. */
  public setCurrentUser(identity: string | null): void {
    this._setScopeValue('_currentUser', identity, DEFAULT_SCOPE.userId)
  }

  /** Возвращает текущий режим выполнения данных для fixtures Store и внешних запусков Query. */
  public get dataMode(): EndgeDataMode {
    return this._dataModeOverride ?? this._workspaceDataMode
  }

  /** Показывает, должны ли runtime-потребители вычислять сохранённые fixtures RMock. */
  public get isMockEnabled(): boolean {
    return this.dataMode === 'mock'
  }

  /** Показывает, получен ли фактический режим из локального runtime-переопределения. */
  public get isDataModeOverridden(): boolean {
    return this._dataModeOverride != null
  }

  /** Применяет сохранённое значение Workspace по умолчанию без записи в локальное хранилище контекста. */
  public setWorkspaceDataMode(mode: EndgeDataMode): void {
    const next = normalizeDataMode(mode)
    if (next === this._workspaceDataMode) {
      return
    }

    const previousEffective = this.dataMode
    this._workspaceDataMode = next
    if (previousEffective !== this.dataMode) {
      this.notify()
    }
  }

  /** Применяет принадлежащее host переопределение режима данных без перестроения структурного контекста. */
  public setDataMode(mode: EndgeDataMode): void {
    const next = normalizeDataMode(mode)
    if (next === this._dataModeOverride) {
      return
    }

    this._dataModeOverride = next
    this.notify()
  }

  /** Удаляет локальное переопределение и восстанавливает текущее значение Workspace по умолчанию. */
  public clearDataModeOverride(): void {
    if (this._dataModeOverride == null) {
      return
    }

    this._dataModeOverride = null
    this.notify()
  }

  /** Упрощённый API для переключателей UI, представляющих mock-режим как boolean-состояние. */
  public setMockEnabled(enabled: boolean): void {
    this.setDataMode(enabled ? 'mock' : 'live')
  }

  /** Возвращает текущую locale контекста. */
  public get currentLocale(): string {
    return this._currentLocale || DEFAULT_LOCALE
  }

  /** Нормализует, сохраняет и публикует новую locale. */
  public setCurrentLocale(locale: string | null): void {
    const configuration = this._activeConfiguration()
    const raw = normalizeOptionalText(locale) ?? DEFAULT_LOCALE
    const next = this._normalizeLocale(raw, configuration)
    this._pendingLocale = configuration ? null : raw
    if (next === this._currentLocale) {
      return
    }

    this._currentLocale = next
    this.saveToStorage()
    this.notify()
  }

  /** Согласует текущую locale с effective configuration после workspace resolution. */
  public reconcileCurrentLocaleWithWorkspace(configuration?: EndgeConfiguration): void {
    const activeConfiguration = configuration ?? this._activeConfiguration()
    if (!activeConfiguration) {
      return
    }

    const pending = this._pendingLocale
    const next = this._normalizeLocale(pending ?? this._currentLocale, activeConfiguration)
    this._pendingLocale = null
    if (next === this._currentLocale) {
      return
    }

    this._currentLocale = next
    this.saveToStorage()
    this.notify()
  }

  /** Возвращает текущую тему контекста. */
  public get currentTheme(): string {
    return this._currentTheme || DEFAULT_THEME
  }

  /** Нормализует, сохраняет и публикует пользовательскую тему. */
  public setCurrentTheme(theme: string | null): void {
    const configuration = this._activeConfiguration()
    const raw = normalizeOptionalText(theme) ?? DEFAULT_THEME
    const next = this._normalizeTheme(raw, configuration)
    const preference = configuration && next !== raw ? null : raw
    const preferenceChanged = preference !== this._themePreference
    const themeChanged = next !== this._currentTheme
    this._themePreference = preference
    if (!preferenceChanged && !themeChanged) {
      return
    }

    this._currentTheme = next
    this.saveToStorage()
    if (themeChanged) {
      this.notify()
    }
  }

  /** Согласует сохранённую тему с effective configuration после workspace resolution. */
  public reconcileCurrentThemeWithWorkspace(configuration?: EndgeConfiguration): void {
    const activeConfiguration = configuration ?? this._activeConfiguration()
    if (!activeConfiguration) {
      return
    }

    const preference = this._themePreference
    const normalizedPreference = preference == null
      ? null
      : this._normalizeTheme(preference, activeConfiguration)
    const next = normalizedPreference == null || normalizedPreference !== preference
      ? activeConfiguration.defaultTheme
      : normalizedPreference
    const preferenceChanged = preference != null && normalizedPreference !== preference
    const themeChanged = next !== this._currentTheme
    if (preferenceChanged) {
      this._themePreference = null
    }
    if (!preferenceChanged && !themeChanged) {
      return
    }

    this._currentTheme = next
    this.saveToStorage()
    if (themeChanged) {
      this.notify()
    }
  }

  /** Возвращает текущую временную зону контекста. */
  public get currentTimezone(): string {
    return this._currentTimezone || DEFAULT_TIMEZONE
  }

  /** Нормализует, сохраняет и публикует новую временную зону. */
  public setCurrentTimezone(timezone: string | null): void {
    const configuration = this._activeConfiguration()
    const raw = normalizeOptionalText(timezone) ?? DEFAULT_TIMEZONE
    const next = this._normalizeTimezone(raw, configuration)
    this._pendingTimezone = configuration ? null : raw
    if (next === this._currentTimezone) {
      return
    }

    this._currentTimezone = next
    this.saveToStorage()
    this.notify()
  }

  /** Согласует сохранённую временную зону с effective configuration. */
  public reconcileCurrentTimezoneWithWorkspace(configuration?: EndgeConfiguration): void {
    const activeConfiguration = configuration ?? this._activeConfiguration()
    if (!activeConfiguration) {
      return
    }

    const pending = this._pendingTimezone
    const next = this._normalizeTimezone(pending ?? this._currentTimezone, activeConfiguration)
    this._pendingTimezone = null
    if (next === this._currentTimezone) {
      return
    }

    this._currentTimezone = next
    this.saveToStorage()
    this.notify()
  }

  /** Возвращает effective configuration либо persisted workspace configuration до resolution. */
  private _activeConfiguration(): EndgeConfiguration | null {
    try {
      if (Endge.configuration.isResolved) {
        return Endge.configuration.current
      }
      if (Endge.workspace.isLoaded) {
        return Endge.workspace.current.configuration
      }
    }
    catch {
      // Federation ещё не завершила configuration lifecycle.
    }
    return null
  }

  private _normalizeLocale(value: string, configuration: EndgeConfiguration | null): string {
    if (!configuration) {
      return value
    }
    return configuration.locales.some(item => item.code === value) ? value : configuration.defaultLocale
  }

  private _normalizeTheme(value: string, configuration: EndgeConfiguration | null): string {
    if (!configuration) {
      return value
    }
    return configuration.themes.some(item => item.identity === value) ? value : configuration.defaultTheme
  }

  private _normalizeTimezone(value: string, configuration: EndgeConfiguration | null): string {
    if (!configuration) {
      return value
    }
    return configuration.timezones.some(item => item.identity === value) ? value : configuration.defaultTimezone
  }

  /** Сохраняет только явное предпочтение; фактическим значением по умолчанию продолжает владеть конфигурация. */
  private _serializeForPersistence(): EndgePersistedContextSnapshot {
    return {
      ...this.serialize(),
      theme: this._themePreference,
      themePreferenceVersion: THEME_PREFERENCE_VERSION,
    }
  }

  /** Выбирает storage adapter для заданной persistence policy. */
  private _resolveAdapter(persistence: EndgePersistenceInput): EndgeStorageAdapter {
    return this._adapters.resolve(persistence)
  }

  private _syncPersistentContextToRaph(): void {
    const snapshot = this.serialize()
    Raph.transaction(() => {
      for (const [key, value] of Object.entries(snapshot)) {
        const path = `${ENDGE_CONTEXT_RAPH_PATH}.${key}`
        this._setRaphValueIfChanged(path, Raph.get(path), value)
      }
    })
  }

  private _setRaphValueIfChanged(path: string, current: unknown, next: unknown): void {
    if (sameContextValue(current, next)) {
      return
    }
    Raph.set(path, Array.isArray(next) ? [...next] : next)
  }

  /** Возвращает identity активного workspace для persistence scope. */
  private _requireCurrentWorkspace(): string {
    if (!this._currentWorkspace) {
      throw new Error('[EndgeContext] Active workspace has not been loaded')
    }
    return this._currentWorkspace
  }

  /** Создаёт безопасный scope для контроллера, который не читает и не изменяет состояние. */
  private _getDisabledPersistenceScope(): EndgePersistenceScope {
    const session = this._resolveSessionIdentity()

    return {
      workspaceId: this._currentWorkspace ?? 'detached',
      tenantId: session.tenantId,
      projectId: this._currentProject,
      environmentId: this._currentEnvironment,
      userId: session.userId,
    }
  }

  /** Вычисляет tenant и user identity текущей сессии. */
  private _resolveSessionIdentity(): { tenantId: string, userId: string } {
    const external = this._sessionProvider?.getCurrentIdentity() ?? null

    return {
      tenantId: normalizeScopePart(external?.tenantId ?? this._currentTenant, DEFAULT_SCOPE.tenantId),
      userId: normalizeScopePart(external?.userId ?? this._currentUser, DEFAULT_SCOPE.userId),
    }
  }

  /** Обновляет одно поле scope и публикует изменение контекста. */
  private _setScopeValue(
    field: '_currentTenant' | '_currentProject' | '_currentEnvironment' | '_currentUser',
    identity: string | null,
    fallback: string,
  ): void {
    const next = normalizeScopePart(identity, fallback)
    if (next === this[field]) {
      return
    }

    this[field] = next
    this.saveToStorage()
    this.notify()
  }

  private _assertStructuralContextMutable(
    field: '_currentTenant' | '_currentProject' | '_currentEnvironment',
    identity: string | null,
    fallback: string,
  ): void {
    const next = normalizeScopePart(identity, fallback)
    if (!this._executionContextLocked || next === this[field]) {
      return
    }
    throw new Error('[EndgeContext] Structural context is immutable during boot. Call Endge.reset() and boot with a new context.')
  }
}

function normalizeDataMode(value: unknown): EndgeDataMode {
  return value === 'mock' ? 'mock' : 'live'
}

function normalizeKeyboardContextSnapshot(input: unknown): EndgeKeyboardContextSnapshot {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
  const rawModifiers = source.modifiers && typeof source.modifiers === 'object' && !Array.isArray(source.modifiers)
    ? source.modifiers as Record<string, unknown>
    : {}
  const rawHeld = source.held && typeof source.held === 'object' && !Array.isArray(source.held)
    ? source.held as Record<string, unknown>
    : {}
  const platform = ['macos', 'windows', 'linux'].includes(String(source.platform))
    ? source.platform as EndgeKeyboardContextSnapshot['platform']
    : 'unknown'
  return {
    platform,
    modifiers: {
      ctrl: rawModifiers.ctrl === true,
      shift: rawModifiers.shift === true,
      alt: rawModifiers.alt === true,
      meta: rawModifiers.meta === true,
      mod: rawModifiers.mod === true,
      altGraph: rawModifiers.altGraph === true,
    },
    held: {
      key: normalizeKeyboardStrings(rawHeld.key, value => value.toLowerCase()),
      code: normalizeKeyboardStrings(rawHeld.code, value => value),
    },
  }
}

function normalizeKeyboardStrings(input: unknown, normalize: (value: string) => string): string[] {
  const values = Array.isArray(input) ? input : []
  return [...new Set(values.map(value => normalize(String(value).trim())).filter(Boolean))].sort()
}

function sameContextValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  }
  return Object.is(left, right)
}

function normalizeScopePart(value: unknown, fallback: string): string {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function normalizeRequiredScopePart(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!normalized) {
    throw new Error(`[EndgeContext] ${field} is required.`)
  }

  return normalized
}

function normalizeIdentityList(values: readonly string[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const identity = normalizeOptionalText(value)
    if (!identity || seen.has(identity)) {
      continue
    }
    seen.add(identity)
    result.push(identity)
  }
  return result
}

function resolveAvailableIdentity(input: {
  label: string
  requested: string | null | undefined
  required: boolean
  available: readonly string[]
  fallbackWhenEmpty?: string
}): string {
  const available = normalizeIdentityList(input.available)
  const requested = normalizeOptionalText(input.requested)
  if (requested && available.includes(requested)) {
    return requested
  }

  if (requested && input.required) {
    throw new Error(`[EndgeContext] ${input.label} "${requested}" was not found in loaded Domain`)
  }

  const fallback = available[0]
  if (fallback) {
    return fallback
  }

  const fallbackWhenEmpty = normalizeOptionalText(input.fallbackWhenEmpty)
  if (fallbackWhenEmpty) {
    return fallbackWhenEmpty
  }

  throw new Error(`[EndgeContext] Cannot resolve ${input.label}: no available entities were loaded`)
}

function readLegacyThemePreference(): string | null {
  try {
    return normalizeOptionalText(LEGACY_STORAGE_ADAPTER.readRaw(LEGACY_THEME_STORAGE_KEY))
  }
  catch {
    return null
  }
}

function readLegacyTimezonePreference(): string | null {
  try {
    const value = normalizeOptionalText(LEGACY_STORAGE_ADAPTER.readRaw(LEGACY_TIMEZONE_STORAGE_KEY))?.toLowerCase()
    if (value === 'false' || value === '0') {
      return 'UTC'
    }
    if (value === 'true' || value === '1') {
      return 'local'
    }
    return null
  }
  catch {
    return null
  }
}
