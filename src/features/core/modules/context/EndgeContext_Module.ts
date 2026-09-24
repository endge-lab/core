import type { EndgeBootContext, EndgeBootMode } from '@/features/core/kernel/types/bootstrap.types'
import type { EndgeConfiguration } from '@/features/core/modules/configuration/domain/types/configuration.type'
import type { ContextEvent } from '@/features/core/modules/context/domain/context-events.types'
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
import type {
  EndgeContextStateListener,
  EndgeContextStateTransform,
} from '@/features/core/modules/context/domain/context-state.types'
import type { EndgePersistenceInput } from '@/features/core/modules/context/persistence/EndgeStorageAdapterRegistry'
import type { EndgeCoreEventMap } from '@/features/core/modules/events/domain/events.types'

import type {
  EndgeExecutionContext,
  EndgeExecutionContextResolutionInput,
} from '@/features/core/modules/runtime/domain/execution-context.types'
import type { EndgeDataMode } from '@/features/core/modules/workspace/domain/workspace.types'
import { Raph } from '@raphy-js/raph'
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
  buildContextStateStorageKey,
  buildUserContextStateStorageKey,
  deserializeContextState,
  normalizeContextStateKey,
  serializeContextState,
} from '@/features/core/modules/context/persistence/context-state'
import {
  EndgeStorageAdapterRegistry,
  normalizePersistence,
} from '@/features/core/modules/context/persistence/EndgeStorageAdapterRegistry'
import { RuntimeStateController } from '@/features/core/modules/context/persistence/RuntimeStateController'
import { EndgeModule } from '@/features/federation/EndgeModule'

interface ContextEventValues {
  workspace: string | null
  facets: Readonly<Record<string, string>>
  user: string
  locale: string
  theme: string
  timezone: string
  dataMode: EndgeDataMode
}

const THEME_PREFERENCE_VERSION = 1 as const
const MAX_CONTEXT_EVENT_PASSES = 100
const LEGACY_STORAGE_ADAPTER = new LocalStorageContextAdapter()

/**
 * Контекст выполнения Endge: текущий workspace/dynamic facets/user scope
 * и координатор persistence-инфраструктуры приложения.
 */
export class EndgeContext_Module extends EndgeModule<EndgeBootContext> {
  private readonly _adapters = new EndgeStorageAdapterRegistry()
  private readonly _runtimeControllers = new Map<string, RuntimeStateController>()
  private readonly _stateListeners = new Map<string, Set<EndgeContextStateListener>>()

  private _contextPersistence: EndgePersistenceOptions = { driver: 'local' }
  private _currentWorkspace: string | null = null
  private _facetSelections: Record<string, string> = Object.create(null)
  private _currentUser: string = DEFAULT_SCOPE.userId
  private _currentLocale = DEFAULT_LOCALE
  private _pendingLocale: string | null = null
  private _hasLocalePreference = false
  private _currentTheme = DEFAULT_THEME
  private _themePreference: string | null = null
  private _hostDefaultTheme: string | null = null
  private _currentTimezone = DEFAULT_TIMEZONE
  private _pendingTimezone: string | null = null
  private _workspaceDataMode: EndgeDataMode = 'live'
  private _dataModeOverride: EndgeDataMode | null = null
  private _sessionProvider: EndgeSessionIdentityProvider | null = null
  private _isHydrating = false
  private _eventContext: ContextEventValues | null = null
  private _publishingContextChanges = false
  private _executionContextLocked = false
  private _bootMode: EndgeBootMode = 'application'
  private _beforeInspection: { context: EndgeContextSnapshot, dataMode: EndgeDataMode, override: EndgeDataMode | null } | null = null

  public get bootMode(): EndgeBootMode { return this._bootMode }

  /**
   * Создаёт контекст, регистрирует storage adapters и восстанавливает snapshot.
   */
  public constructor() {
    super()
    this.registerStorageAdapter(new LocalStorageContextAdapter())
    this.registerStorageAdapter(new DisabledContextAdapter())
    this.loadFromStorage()
  }

  /**
   * Применяет explicit structural context до load/build остальных модулей.
   */
  public override setup(ctx: EndgeBootContext): void {
    this._bootMode = ctx.mode ?? 'application'
    this._executionContextLocked = false
    if (this._bootMode === 'debugger') {
      this._beforeInspection = { context: this.serialize(), dataMode: this._workspaceDataMode, override: this._dataModeOverride }
      this._sessionProvider = null
      this._currentWorkspace = null
      this._executionContextLocked = true
      return
    }
    const defaultLocale = normalizeOptionalText(ctx.ui?.defaultLocale)
    if (!this._hasLocalePreference && defaultLocale) {
      this._currentLocale = defaultLocale
      this._pendingLocale = defaultLocale
    }
    this._hostDefaultTheme = normalizeOptionalText(ctx.ui?.defaultTheme)
    this._executionContextLocked = true
    this._syncPersistentContextToRaph()
    this._publishContextChanges()
  }

  /**
   * Разрешает выбрать новый structural context только перед следующим boot.
   */
  public override reset(): void {
    if (this._beforeInspection) {
      const { context, dataMode, override } = this._beforeInspection
      this._currentWorkspace = context.workspace
      this._facetSelections = normalizeFacetSelections(context.facets)
      this._currentUser = context.user ?? DEFAULT_SCOPE.userId
      this._workspaceDataMode = dataMode
      this._dataModeOverride = override
      this._beforeInspection = null
    }
    this._bootMode = 'application'
    this._executionContextLocked = false
    this.notify()
  }

  /**
   * Показывает, выполняется ли восстановление контекста из storage.
   */
  public get isLoadingFromStorage(): boolean {
    return this._isHydrating
  }

  /**
   * Регистрирует storage adapter для persistence-контекста.
   */
  public registerStorageAdapter(adapter: EndgeStorageAdapter): void {
    this._adapters.register(adapter)
  }

  /**
   * Настраивает persistence текущего контекста.
   */
  public configurePersistence(config: EndgeContextPersistenceConfig): void {
    if (config.context == null) {
      return
    }

    this._contextPersistence = normalizePersistence(config.context)
    this.saveToStorage()
  }

  /**
   * Устанавливает provider актуальных user identity и обязательных session facet selections.
   */
  public setSessionIdentityProvider(provider: EndgeSessionIdentityProvider | null): void {
    this._sessionProvider = provider
    this.notify()
  }

  /**
   * Показывает, что выбор документа фасета задан authenticated session provider.
   */
  public isFacetLockedBySession(facetIdentity: string): boolean {
    const identity = normalizeOptionalText(facetIdentity)
    const selections = this._sessionProvider?.getCurrentIdentity()?.facetSelections
    return identity != null && selections != null && Object.hasOwn(selections, identity)
  }

  /**
   * Сериализует текущий execution scope в snapshot.
   */
  public override createDiagnosticsSnapshot(): Record<string, unknown> {
    return {
      ...this.serialize(),
      user: this.getCurrentUser(),
      execution: this.getExecutionContext(),
      dataMode: this.dataMode,
      input: {
        keyboard: this.getKeyboardState(),
      },
    }
  }

  public override serialize(): EndgeContextSnapshot {
    return {
      workspace: this._currentWorkspace,
      facets: freezeFacetSelections(this._facetSelections),
      user: this._currentUser,
      locale: this._currentLocale || null,
      theme: this._currentTheme || null,
      timezone: this._currentTimezone || null,
    }
  }

  /**
   * Возвращает полный доступный SFC контекст без добавления временных значений в persistence.
   */
  public runtimeSnapshot(): EndgeRuntimeContextSnapshot {
    return {
      ...this.serialize(),
      config: createEndgePublicConfigurationSnapshot(Endge.configuration.current),
      input: {
        keyboard: this.getKeyboardState(),
      },
    }
  }

  /**
   * Возвращает текущее временное состояние клавиатуры из общего пространства контекста Raph.
   */
  public getKeyboardState(): EndgeKeyboardContextSnapshot {
    return normalizeKeyboardContextSnapshot(Raph.get(ENDGE_KEYBOARD_CONTEXT_RAPH_PATH))
  }

  /**
   * Публикует состояние клавиатуры UI-адаптера как узкие несохраняемые изменения Raph.
   */
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

  /**
   * Сохраняет подписчиков legacy-модуля и проецирует постоянные поля контекста в Raph.
   */
  public override notify(): void {
    this._syncPersistentContextToRaph()
    this._publishContextChanges()
    super.notify()
  }

  /**
   * Применяет типизированное событие через setters, сохраняя их проверки и side effects.
   */
  public applyEvent(event: ContextEvent): void {
    switch (event.name) {
      case 'context:workspace-changed':
        return this.setCurrentWorkspace(event.payload.value)
      case 'context:facets-changed':
        return this.setFacetSelections(event.payload.value)
      case 'context:user-changed':
        return this.setCurrentUser(event.payload.value)
      case 'context:locale-changed':
        return this.setCurrentLocale(event.payload.value)
      case 'context:theme-changed':
        return this.setCurrentTheme(event.payload.value)
      case 'context:timezone-changed':
        return this.setCurrentTimezone(event.payload.value)
      case 'context:data-mode-changed':
        return this.setDataMode(event.payload.value)
    }
  }

  /**
   * Восстанавливает execution scope из snapshot с безопасными defaults.
   */
  public override deserialize(payload: Partial<EndgeContextSnapshot> | undefined): void {
    this._currentWorkspace = normalizeOptionalText(payload?.workspace)
    this._facetSelections = normalizeFacetSelections(payload?.facets)
    this._currentUser = normalizeScopePart(payload?.user, DEFAULT_SCOPE.userId)
    const rawLocale = normalizeOptionalText(payload?.locale)
    this._hasLocalePreference = rawLocale != null
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
    this._publishContextChanges()
  }

  /**
   * Adopts observed scope only in memory; developer authorization stays with the host session.
   */
  public applyInspection(snapshot: EndgeContextSnapshot & { dataMode?: EndgeDataMode }): void {
    if (this._bootMode !== 'debugger') {
      throw new Error('[EndgeContext] Inspection requires debugger mode')
    }
    this._currentWorkspace = snapshot.workspace
    this._facetSelections = normalizeFacetSelections(snapshot.facets)
    this._currentUser = snapshot.user ?? DEFAULT_SCOPE.userId
    this._workspaceDataMode = snapshot.dataMode ?? 'live'
    this._dataModeOverride = null
    this._currentLocale = snapshot.locale ?? DEFAULT_LOCALE
    this._pendingLocale = null
    this._currentTheme = snapshot.theme ?? DEFAULT_THEME
    this._themePreference = null
    this._currentTimezone = snapshot.timezone ?? DEFAULT_TIMEZONE
    this._pendingTimezone = null
    // Снимок задаёт baseline напрямую: импорт не выполняет команды и не переиздаёт события клиента.
    this._eventContext = this._readEventContext()
    this.notify()
  }

  /**
   * Сохраняет текущий context snapshot через выбранный adapter.
   */
  public saveToStorage(): void {
    if (this._bootMode === 'debugger') {
      return
    }
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

  /**
   * Загружает context snapshot из нового или legacy storage key.
   */
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

  /**
   * Возвращает полный persistence scope текущей сессии.
   */
  public getPersistenceScope(): EndgePersistenceScope {
    return {
      workspaceId: this._requireCurrentWorkspace(),
      facetSelections: Object.entries(this._facetSelections).map(([facetIdentity, documentIdentity]) => ({
        facetIdentity,
        documentIdentity,
      })),
      userId: this.getCurrentUser(),
    }
  }

  /**
   * Читает личную настройку явно указанного пользователя host, в том числе в debugger.
   */
  public getUserState<T>(userId: string, key: string, transform?: EndgeContextStateTransform<T>): T | undefined {
    const storageKey = buildUserContextStateStorageKey(userId, key)
    try {
      const value = this._resolveAdapter(this._contextPersistence).read<unknown>(storageKey)
      return value === undefined ? undefined : deserializeContextState(value, transform)
    }
    catch (error) {
      this._warnStateFailure('read', key, error)
      return undefined
    }
  }

  /**
   * Сохраняет личную настройку host, не меняя контекст или данные инспектируемого приложения.
   */
  public setUserState<T>(userId: string, key: string, state: T, transform?: EndgeContextStateTransform<T>): void {
    const storageKey = buildUserContextStateStorageKey(userId, key)
    try {
      const value = serializeContextState(state, transform)
      if (value === undefined) {
        throw new Error('State serializer returned undefined.')
      }
      this._resolveAdapter(this._contextPersistence).write(storageKey, value)
    }
    catch (error) {
      this._warnStateFailure('write', key, error)
    }
  }

  /**
   * Возвращает dynamic state текущего полного context scope.
   */
  public getState<T>(
    key: string,
    transform?: EndgeContextStateTransform<T>,
  ): T | undefined {
    const normalizedKey = normalizeContextStateKey(key)
    if (this._bootMode === 'debugger' || !this._currentWorkspace) {
      return undefined
    }
    try {
      const storageKey = buildContextStateStorageKey(this.getPersistenceScope(), normalizedKey)
      const value = this._resolveAdapter(this._contextPersistence).read<unknown>(storageKey)
      return value === undefined ? undefined : deserializeContextState(value, transform)
    }
    catch (error) {
      this._warnStateFailure('read', normalizedKey, error)
      return undefined
    }
  }

  /**
   * Сохраняет dynamic state в scope текущих workspace/facet selections/user.
   */
  public setState<T>(
    key: string,
    state: T,
    transform?: EndgeContextStateTransform<T>,
  ): void {
    if (this._bootMode === 'debugger') {
      return
    }
    const normalizedKey = normalizeContextStateKey(key)
    try {
      const storageKey = buildContextStateStorageKey(this.getPersistenceScope(), normalizedKey)
      const value = serializeContextState(state, transform)
      if (value === undefined) {
        throw new Error('State serializer returned undefined. Use removeState() to delete a value.')
      }
      this._resolveAdapter(this._contextPersistence).write(storageKey, value)
      this._notifyState(normalizedKey)
    }
    catch (error) {
      this._warnStateFailure('write', normalizedKey, error)
    }
  }

  /**
   * Удаляет dynamic state только из текущего полного context scope.
   */
  public removeState(key: string): void {
    if (this._bootMode === 'debugger') {
      return
    }
    const normalizedKey = normalizeContextStateKey(key)
    try {
      const storageKey = buildContextStateStorageKey(this.getPersistenceScope(), normalizedKey)
      this._resolveAdapter(this._contextPersistence).remove(storageKey)
      this._notifyState(normalizedKey)
    }
    catch (error) {
      this._warnStateFailure('remove', normalizedKey, error)
    }
  }

  /**
   * Подписывает потребителя на изменения одного dynamic state key.
   */
  public subscribeState(key: string, listener: EndgeContextStateListener): () => void {
    const normalizedKey = normalizeContextStateKey(key)
    const listeners = this._stateListeners.get(normalizedKey) ?? new Set<EndgeContextStateListener>()
    listeners.add(listener)
    this._stateListeners.set(normalizedKey, listeners)

    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this._stateListeners.delete(normalizedKey)
      }
    }
  }

  /**
   * Создаёт или возвращает controller runtime-состояния по runtime id.
   */
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

  /**
   * Возвращает runtime state controller по id.
   */
  public getRuntimeStateController(runtimeId: string): RuntimeStateController | null {
    return this._runtimeControllers.get(String(runtimeId ?? '').trim()) ?? null
  }

  /**
   * Удаляет runtime state controller из registry.
   */
  public destroyRuntimeStateController(runtimeId: string): void {
    this._runtimeControllers.delete(String(runtimeId ?? '').trim())
  }

  /**
   * Возвращает identity текущего workspace.
   */
  public getCurrentWorkspace(): string | null {
    return this._currentWorkspace
  }

  /**
   * Устанавливает текущий workspace и сохраняет контекст.
   */
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

  /**
   * Возвращает immutable map выбранных документов по identity фасета.
   */
  public getFacetSelections(): Readonly<Record<string, string>> {
    return freezeFacetSelections(this._facetSelections)
  }

  /**
   * Возвращает выбранный документ фасета либо null, если фасет не имеет выбора.
   */
  public getFacetSelection(facetIdentity: string): string | null {
    const identity = normalizeOptionalText(facetIdentity)
    return identity ? this._facetSelections[identity] ?? null : null
  }

  /**
   * Устанавливает один выбор до следующего structural boot.
   */
  public setFacetSelection(facetIdentity: string, documentIdentity: string | null): void {
    const facet = normalizeRequiredScopePart(facetIdentity, 'facetIdentity')
    const document = normalizeOptionalText(documentIdentity)
    const next = normalizeFacetSelections(this._facetSelections)
    if (document) {
      next[facet] = document
    }
    else {
      delete next[facet]
    }
    this.setFacetSelections(next)
  }

  /**
   * Заменяет structural map до следующего boot.
   */
  public setFacetSelections(selections: Readonly<Record<string, string>>): void {
    const next = normalizeFacetSelections(selections)
    this._assertStructuralContextMutable(next)
    if (sameFacetSelections(next, this._facetSelections)) {
      return
    }
    this._facetSelections = next
    this.saveToStorage()
    this.notify()
  }

  /**
   * Возвращает immutable structural coordinates текущего boot lifecycle.
   */
  public getExecutionContext(): EndgeExecutionContext {
    return Object.freeze({ facets: freezeFacetSelections(this._facetSelections) })
  }

  /**
   * Разрешает structural context после загрузки Domain, но до configuration/build.
   * Explicit и session coordinates обязательны; сохранённые preferences могут
   * безопасно перейти на первую доступную сущность, если Domain изменился.
   */
  public resolveExecutionContext(input: EndgeExecutionContextResolutionInput): EndgeExecutionContext {
    const explicit = normalizeRequestedFacetSelections(input.explicit?.facets, 'explicit')
    const session = normalizeRequestedFacetSelections(
      this._sessionProvider?.getCurrentIdentity()?.facetSelections,
      'session',
    )
    const facets = input.facets
      .map(facet => ({
        identity: normalizeRequiredScopePart(facet.identity, 'facet identity'),
        position: Number.isFinite(facet.position) ? facet.position : 0,
        documents: normalizeIdentityList(facet.documents).sort(),
      }))
      .sort((left, right) => left.position - right.position || left.identity.localeCompare(right.identity))
    const activeFacetIdentities = new Set(facets.map(facet => facet.identity))
    if (activeFacetIdentities.size !== facets.length) {
      throw new Error('[EndgeContext] Active facet identities must be unique')
    }
    for (const [source, selections] of [['explicit', explicit], ['session', session]] as const) {
      for (const facetIdentity of Object.keys(selections)) {
        if (!activeFacetIdentities.has(facetIdentity)) {
          throw new Error(`[EndgeContext] ${source} Facet "${facetIdentity}" was not found in loaded Domain`)
        }
      }
    }
    const next: Record<string, string> = Object.create(null)
    for (const facet of facets) {
      const fromSession = Object.hasOwn(session, facet.identity)
      const fromExplicit = Object.hasOwn(explicit, facet.identity)
      const requested = fromSession
        ? session[facet.identity]
        : fromExplicit
          ? explicit[facet.identity]
          : this._facetSelections[facet.identity]
      if (facet.documents.length === 0) {
        if (fromSession || fromExplicit) {
          throw new Error(`[EndgeContext] Facet "${facet.identity}" has no active documents`)
        }
        continue
      }
      next[facet.identity] = resolveAvailableIdentity({
        label: `Facet "${facet.identity}"`,
        requested,
        required: fromSession || fromExplicit,
        available: facet.documents,
      })
    }

    const changed = !sameFacetSelections(next, this._facetSelections)
    this._facetSelections = next
    this.saveToStorage()

    if (changed) {
      this.notify()
    }

    return this.getExecutionContext()
  }

  /**
   * Возвращает identity текущего user с учётом session provider.
   */
  public getCurrentUser(): string {
    return this._resolveSessionIdentity().userId
  }

  /**
   * Устанавливает fallback identity текущего user.
   */
  public setCurrentUser(identity: string | null): void {
    this._setScopeValue('_currentUser', identity, DEFAULT_SCOPE.userId)
  }

  /**
   * Возвращает текущий режим выполнения данных для fixtures Store и внешних запусков Query.
   */
  public get dataMode(): EndgeDataMode {
    return this._dataModeOverride ?? this._workspaceDataMode
  }

  /**
   * Показывает, должны ли runtime-потребители вычислять сохранённые fixtures RMock.
   */
  public get isMockEnabled(): boolean {
    return this.dataMode === 'mock'
  }

  /**
   * Показывает, получен ли фактический режим из локального runtime-переопределения.
   */
  public get isDataModeOverridden(): boolean {
    return this._dataModeOverride != null
  }

  /**
   * Применяет сохранённое значение Workspace по умолчанию без записи в локальное хранилище контекста.
   */
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

  /**
   * Применяет принадлежащее host переопределение режима данных без перестроения структурного контекста.
   */
  public setDataMode(mode: EndgeDataMode): void {
    const next = normalizeDataMode(mode)
    if (next === this._dataModeOverride) {
      return
    }

    this._dataModeOverride = next
    this.notify()
  }

  /**
   * Удаляет локальное переопределение и восстанавливает текущее значение Workspace по умолчанию.
   */
  public clearDataModeOverride(): void {
    if (this._dataModeOverride == null) {
      return
    }

    this._dataModeOverride = null
    this.notify()
  }

  /**
   * Упрощённый API для переключателей UI, представляющих mock-режим как boolean-состояние.
   */
  public setMockEnabled(enabled: boolean): void {
    this.setDataMode(enabled ? 'mock' : 'live')
  }

  /**
   * Возвращает текущую locale контекста.
   */
  public get currentLocale(): string {
    return this._currentLocale || DEFAULT_LOCALE
  }

  /**
   * Нормализует, сохраняет и публикует новую locale.
   */
  public setCurrentLocale(locale: string | null): void {
    this._hasLocalePreference = true
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

  /**
   * Согласует текущую locale с effective configuration после workspace resolution.
   */
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

  /**
   * Возвращает текущую тему контекста.
   */
  public get currentTheme(): string {
    return this._currentTheme || DEFAULT_THEME
  }

  /**
   * Нормализует, сохраняет и публикует пользовательскую тему.
   */
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

  /**
   * Согласует сохранённую тему с effective configuration после workspace resolution.
   */
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
      ? this._normalizeTheme(this._hostDefaultTheme ?? activeConfiguration.defaultTheme, activeConfiguration)
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

  /**
   * Возвращает текущую временную зону контекста.
   */
  public get currentTimezone(): string {
    return this._currentTimezone || DEFAULT_TIMEZONE
  }

  /**
   * Нормализует, сохраняет и публикует новую временную зону.
   */
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

  /**
   * Согласует сохранённую временную зону с effective configuration.
   */
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

  /**
   * Возвращает effective configuration либо persisted workspace configuration до resolution.
   */
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

  /**
   * Сохраняет только явное предпочтение; фактическим значением по умолчанию продолжает владеть конфигурация.
   */
  private _serializeForPersistence(): EndgePersistedContextSnapshot {
    return {
      ...this.serialize(),
      theme: this._themePreference,
      themePreferenceVersion: THEME_PREFERENCE_VERSION,
    }
  }

  /**
   * Выбирает storage adapter для заданной persistence policy.
   */
  private _resolveAdapter(persistence: EndgePersistenceInput): EndgeStorageAdapter {
    return this._adapters.resolve(persistence)
  }

  private _notifyState(key: string): void {
    for (const listener of [...(this._stateListeners.get(key) ?? [])]) {
      try {
        listener()
      }
      catch (error) {
        console.error(
          `[EndgeContext] State listener failed for "${key}": ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  private _warnStateFailure(
    operation: 'read' | 'write' | 'remove',
    key: string,
    error: unknown,
  ): void {
    console.warn(
      `[EndgeContext] Failed to ${operation} state "${key}": ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  /**
   * Снимок фактических значений: session identities и effective data mode включены.
   */
  private _readEventContext(): ContextEventValues {
    return {
      workspace: this.getCurrentWorkspace(),
      facets: this.getFacetSelections(),
      user: this.getCurrentUser(),
      locale: this.currentLocale,
      theme: this.currentTheme,
      timezone: this.currentTimezone,
      dataMode: this.dataMode,
    }
  }

  /**
   * Constructor hydration задаёт baseline; последующие commits публикуют только изменения.
   */
  private _publishContextChanges(): void {
    if (this._publishingContextChanges) {
      return
    }
    const current = this._readEventContext()
    if (!this._eventContext) {
      this._eventContext = current
      return
    }

    this._publishingContextChanges = true
    try {
      // Изменение Context из подписчика становится следующим согласованным пакетом.
      // Здесь нет истории или накопления событий между вызовами.
      let previous: ContextEventValues
      let next = current
      let passes = 0
      do {
        if (++passes > MAX_CONTEXT_EVENT_PASSES) {
          // Циклический subscriber не должен навсегда блокировать пользовательский поток.
          this._eventContext = next
          console.error('[EndgeContext] Cyclic context changes: event delivery stopped for this update')
          break
        }
        previous = this._eventContext
        this._eventContext = next
        this._emitContextChange('context:workspace-changed', previous.workspace, next.workspace)
        this._emitContextChange('context:facets-changed', previous.facets, next.facets)
        this._emitContextChange('context:user-changed', previous.user, next.user)
        this._emitContextChange('context:locale-changed', previous.locale, next.locale)
        this._emitContextChange('context:theme-changed', previous.theme, next.theme)
        this._emitContextChange('context:timezone-changed', previous.timezone, next.timezone)
        this._emitContextChange('context:data-mode-changed', previous.dataMode, next.dataMode)
        next = this._readEventContext()
      } while (Object.keys(next).some(key => !sameContextValue(next[key as keyof ContextEventValues], this._eventContext![key as keyof ContextEventValues])))
    }
    finally {
      this._publishingContextChanges = false
    }
  }

  private _emitContextChange<K extends keyof EndgeCoreEventMap & `context:${string}`>(
    name: K,
    previous: EndgeCoreEventMap[K]['previous'],
    value: EndgeCoreEventMap[K]['value'],
  ): void {
    if (!sameContextValue(previous, value)) {
      Endge.events.emitEvent(name, Object.freeze({ previous, value }) as EndgeCoreEventMap[K])
    }
  }

  private _syncPersistentContextToRaph(): void {
    if (this._bootMode === 'debugger') {
      return
    }
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
    Raph.set(path, Array.isArray(next)
      ? [...next]
      : isPlainRecord(next)
        ? { ...next }
        : next)
  }

  /**
   * Возвращает identity активного workspace для persistence scope.
   */
  private _requireCurrentWorkspace(): string {
    if (!this._currentWorkspace) {
      throw new Error('[EndgeContext] Active workspace has not been loaded')
    }
    return this._currentWorkspace
  }

  /**
   * Создаёт безопасный scope для контроллера, который не читает и не изменяет состояние.
   */
  private _getDisabledPersistenceScope(): EndgePersistenceScope {
    return {
      workspaceId: this._currentWorkspace ?? 'detached',
      facetSelections: Object.entries(this._facetSelections).map(([facetIdentity, documentIdentity]) => ({
        facetIdentity,
        documentIdentity,
      })),
      userId: this.getCurrentUser(),
    }
  }

  /**
   * Вычисляет user identity текущей сессии.
   */
  private _resolveSessionIdentity(): { userId: string } {
    const external = this._sessionProvider?.getCurrentIdentity() ?? null

    return {
      userId: normalizeScopePart(external?.userId ?? this._currentUser, DEFAULT_SCOPE.userId),
    }
  }

  /**
   * Обновляет одно поле scope и публикует изменение контекста.
   */
  private _setScopeValue(
    field: '_currentUser',
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
    next: Readonly<Record<string, string>>,
  ): void {
    if (this._bootMode === 'debugger' || !this._executionContextLocked || sameFacetSelections(next, this._facetSelections)) {
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
  if (isPlainRecord(left) && isPlainRecord(right)) {
    return sameFacetSelections(left, right)
  }
  return Object.is(left, right)
}

function normalizeFacetSelections(value: unknown): Record<string, string> {
  const result: Record<string, string> = Object.create(null)
  if (!isPlainRecord(value)) {
    return result
  }
  for (const [rawFacet, rawDocument] of Object.entries(value)) {
    const facet = normalizeOptionalText(rawFacet)
    const document = normalizeOptionalText(rawDocument)
    if (facet && document) {
      result[facet] = document
    }
  }
  return result
}

function normalizeRequestedFacetSelections(
  value: unknown,
  source: 'explicit' | 'session',
): Record<string, string> {
  if (value == null) {
    return Object.create(null)
  }
  if (!isPlainRecord(value)) {
    throw new Error(`[EndgeContext] ${source} facet selections must be an object`)
  }
  const result: Record<string, string> = Object.create(null)
  for (const [rawFacet, rawDocument] of Object.entries(value)) {
    const facet = normalizeOptionalText(rawFacet)
    const document = normalizeOptionalText(rawDocument)
    if (!facet || !document) {
      throw new Error(`[EndgeContext] ${source} facet selection must contain non-empty identities`)
    }
    result[facet] = document
  }
  return result
}

function freezeFacetSelections(value: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.freeze({ ...value })
}

function sameFacetSelections(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  return leftEntries.length === rightEntries.length
    && leftEntries.every(([key, value], index) => {
      const rightEntry = rightEntries[index]
      return rightEntry?.[0] === key && Object.is(rightEntry[1], value)
    })
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
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
