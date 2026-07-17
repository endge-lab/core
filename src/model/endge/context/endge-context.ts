import type {
  EndgePersistenceDriver,
  EndgePersistenceOptions,
  EndgePersistenceScope,
  EndgeSessionIdentityProvider,
  EndgeStorageAdapter,
} from '@/domain/types/runtime/context-persistence.types'
import type { EndgeExecutionContext } from '@/domain/types/configuration'
import type { EndgeBootContext } from '@/domain/types/kernel/bootstrap.types'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import {
  getActiveEndgeConfiguration,
  hasActiveEndgeWorkspace,
  normalizeWorkspaceLocale,
  normalizeWorkspaceTheme,
} from '@/model/config/endge-workspace'
import {
  EndgeStorageAdapterRegistry,
  normalizePersistence,
  type EndgePersistenceInput,
} from '@/model/endge/context/persistence/EndgeStorageAdapterRegistry'
import { RuntimeStateController } from '@/model/endge/context/persistence/RuntimeStateController'
import { DisabledContextAdapter } from '@/model/endge/context/persistence/adapters/DisabledContextAdapter'
import { LocalStorageContextAdapter } from '@/model/endge/context/persistence/adapters/LocalStorageContextAdapter'

const CONTEXT_STORAGE_KEY = 'endge:context:v1'
const LEGACY_CONTEXT_STORAGE_KEY = 'endge-context'
const LEGACY_THEME_STORAGE_KEY = 'endge:theme'

const DEFAULT_SCOPE = {
  tenantId: 'default',
  projectId: 'default',
  environmentId: 'dev',
  userId: 'anonymous',
} satisfies Omit<EndgePersistenceScope, 'workspaceId'>

export interface EndgeContextSnapshot {
  workspace: string | null
  tenant: string | null
  project: string | null
  environment: string | null
  user: string | null
  locale: string | null
  theme: string | null
}

export interface EndgeContextPersistenceConfig {
  context?: EndgePersistenceDriver | EndgePersistenceOptions | null
}

export interface EndgeExecutionContextProjectCandidate {
  identity: string
  allowedEnvironmentIds: readonly number[]
}

export interface EndgeExecutionContextEnvironmentCandidate {
  id: string | number
  identity: string
}

export interface EndgeExecutionContextResolutionInput {
  explicit?: Partial<EndgeExecutionContext>
  tenants: readonly string[]
  projects: readonly EndgeExecutionContextProjectCandidate[]
  environments: readonly EndgeExecutionContextEnvironmentCandidate[]
}

/**
 * Контекст выполнения Endge: текущий workspace/project/environment/user scope
 * и координатор persistence-инфраструктуры приложения.
 */
export class EndgeContext extends EndgeModule {
  private readonly _adapters = new EndgeStorageAdapterRegistry()
  private readonly _runtimeControllers = new Map<string, RuntimeStateController>()

  private _contextPersistence: EndgePersistenceOptions = { driver: 'local' }
  private _currentWorkspace: string | null = null
  private _currentTenant: string = DEFAULT_SCOPE.tenantId
  private _currentProject: string = DEFAULT_SCOPE.projectId
  private _currentEnvironment: string = DEFAULT_SCOPE.environmentId
  private _currentUser: string = DEFAULT_SCOPE.userId
  private _currentLocale = ''
  private _pendingLocale: string | null = null
  private _currentTheme = ''
  private _pendingTheme: string | null = null
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
      if (input.tenantIdentity != null)
        this._currentTenant = normalizeScopePart(input.tenantIdentity, DEFAULT_SCOPE.tenantId)
      if (input.projectIdentity != null)
        this._currentProject = normalizeScopePart(input.projectIdentity, DEFAULT_SCOPE.projectId)
      if (input.environmentIdentity != null)
        this._currentEnvironment = normalizeScopePart(input.environmentIdentity, DEFAULT_SCOPE.environmentId)
    }
    this._executionContextLocked = true
  }

  /** Разрешает выбрать новый structural context только перед следующим boot. */
  public override reset(): void {
    this._executionContextLocked = false
    this.notify()
  }

  /** Показывает, выполняется ли восстановление контекста из storage. */
  get isLoadingFromStorage(): boolean {
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
  get isTenantLockedBySession(): boolean {
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
    }
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
    if (hasActiveEndgeWorkspace()) {
      this._currentLocale = normalizeWorkspaceLocale(rawLocale)
      this._pendingLocale = null
      this._currentTheme = normalizeWorkspaceTheme(rawTheme)
      this._pendingTheme = null
    }
    else {
      this._currentLocale = rawLocale ?? ''
      this._pendingLocale = rawLocale
      this._currentTheme = rawTheme ?? ''
      this._pendingTheme = rawTheme
    }
  }

  /** Сохраняет текущий context snapshot через выбранный adapter. */
  public saveToStorage(): void {
    if (this._isHydrating) {
      return
    }

    try {
      this.resolveAdapter(this._contextPersistence).write(CONTEXT_STORAGE_KEY, this.serialize())
    }
    catch {
      /* Ошибка storage не должна прерывать работу контекста. */
    }
  }

  /** Загружает context snapshot из нового или legacy storage key. */
  public loadFromStorage(): EndgeContextSnapshot | undefined {
    this._isHydrating = true
    try {
      const adapter = this.resolveAdapter(this._contextPersistence)
      const snapshot = adapter.read<EndgeContextSnapshot>(CONTEXT_STORAGE_KEY)
        ?? adapter.read<Partial<EndgeContextSnapshot>>(LEGACY_CONTEXT_STORAGE_KEY)

      this.deserialize(snapshot)
      return this.serialize()
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

  /** Возвращает полный persistence scope текущей сессии. */
  public getPersistenceScope(): EndgePersistenceScope {
    const session = this.resolveSessionIdentity()

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
      scope: persistence.driver === 'disabled'
        ? this.getDisabledPersistenceScope()
        : this.getPersistenceScope(),
      adapter: this.resolveAdapter(persistence),
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
    if (next === this._currentWorkspace)
      return

    this._currentWorkspace = next
    this.saveToStorage()
    this.notify()
  }

  /** Возвращает identity текущего tenant с учётом session provider. */
  public getCurrentTenant(): string {
    return this.resolveSessionIdentity().tenantId
  }

  /** Устанавливает fallback identity текущего tenant. */
  public setCurrentTenant(identity: string | null): void {
    this.assertStructuralContextMutable('_currentTenant', identity, DEFAULT_SCOPE.tenantId)
    this.setScopeValue('_currentTenant', identity, DEFAULT_SCOPE.tenantId)
  }

  /** Возвращает identity текущего project. */
  public getCurrentProject(): string {
    return this._currentProject
  }

  /** Устанавливает текущий project и сохраняет контекст. */
  public setCurrentProject(identity: string | null): void {
    this.assertStructuralContextMutable('_currentProject', identity, DEFAULT_SCOPE.projectId)
    this.setScopeValue('_currentProject', identity, DEFAULT_SCOPE.projectId)
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
    this.assertStructuralContextMutable('_currentEnvironment', identity, DEFAULT_SCOPE.environmentId)
    this.setScopeValue('_currentEnvironment', identity, DEFAULT_SCOPE.environmentId)
  }

  /** Возвращает identity текущего user с учётом session provider. */
  public getCurrentUser(): string {
    return this.resolveSessionIdentity().userId
  }

  /** Устанавливает fallback identity текущего user. */
  public setCurrentUser(identity: string | null): void {
    this.setScopeValue('_currentUser', identity, DEFAULT_SCOPE.userId)
  }

  /** Возвращает текущую locale или locale активного workspace. */
  get currentLocale(): string {
    return this._currentLocale || getActiveEndgeConfiguration().defaultLocale
  }

  /** Нормализует, сохраняет и публикует новую locale. */
  set currentLocale(value: string) {
    const next = normalizeWorkspaceLocale(value)
    if (next === this._currentLocale) {
      return
    }
    this._currentLocale = next
    this._pendingLocale = null
    this.saveToStorage()
    this.notify()
  }

  /** Устанавливает текущую locale через публичный method API. */
  public setCurrentLocale(locale: string | null): void {
    this.currentLocale = normalizeWorkspaceLocale(locale)
  }

  /** Согласует текущую locale с активной workspace-конфигурацией. */
  public reconcileCurrentLocaleWithWorkspace(): void {
    const pending = this._pendingLocale
    const next = normalizeWorkspaceLocale(pending ?? this._currentLocale)
    this._pendingLocale = null
    if (next === this._currentLocale)
      return

    this._currentLocale = next
    this.saveToStorage()
    this.notify()
  }

  /** Возвращает текущую тему или тему по умолчанию активного workspace. */
  get currentTheme(): string {
    return this._currentTheme || getActiveEndgeConfiguration().defaultTheme
  }

  /** Нормализует, сохраняет и публикует пользовательскую тему. */
  set currentTheme(value: string) {
    const next = normalizeWorkspaceTheme(value)
    if (next === this._currentTheme)
      return

    this._currentTheme = next
    this._pendingTheme = null
    this.saveToStorage()
    this.notify()
  }

  /** Устанавливает текущую пользовательскую тему. */
  public setCurrentTheme(theme: string | null): void {
    this.currentTheme = normalizeWorkspaceTheme(theme)
  }

  /** Согласует сохранённую тему с каталогом активного workspace. */
  public reconcileCurrentThemeWithWorkspace(): void {
    const pending = this._pendingTheme
    const next = normalizeWorkspaceTheme(pending ?? this._currentTheme)
    this._pendingTheme = null
    if (next === this._currentTheme)
      return

    this._currentTheme = next
    this.saveToStorage()
    this.notify()
  }

  /** Выбирает storage adapter для заданной persistence policy. */
  private resolveAdapter(persistence: EndgePersistenceInput): EndgeStorageAdapter {
    return this._adapters.resolve(persistence)
  }

  /** Возвращает identity активного workspace для persistence scope. */
  private _requireCurrentWorkspace(): string {
    if (!this._currentWorkspace)
      throw new Error('[EndgeContext] Active workspace has not been loaded from Payload')
    return this._currentWorkspace
  }

  /** Builds a harmless scope for a controller that never reads or writes state. */
  private getDisabledPersistenceScope(): EndgePersistenceScope {
    const session = this.resolveSessionIdentity()

    return {
      workspaceId: this._currentWorkspace ?? 'detached',
      tenantId: session.tenantId,
      projectId: this._currentProject,
      environmentId: this._currentEnvironment,
      userId: session.userId,
    }
  }

  /** Вычисляет tenant и user identity текущей сессии. */
  private resolveSessionIdentity(): { tenantId: string, userId: string } {
    const external = this._sessionProvider?.getCurrentIdentity() ?? null

    return {
      tenantId: normalizeScopePart(external?.tenantId ?? this._currentTenant, DEFAULT_SCOPE.tenantId),
      userId: normalizeScopePart(external?.userId ?? this._currentUser, DEFAULT_SCOPE.userId),
    }
  }

  /** Обновляет одно поле scope и публикует изменение контекста. */
  private setScopeValue(
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

  private assertStructuralContextMutable(
    field: '_currentTenant' | '_currentProject' | '_currentEnvironment',
    identity: string | null,
    fallback: string,
  ): void {
    const next = normalizeScopePart(identity, fallback)
    if (!this._executionContextLocked || next === this[field])
      return
    throw new Error('[EndgeContext] Structural context is immutable during boot. Call Endge.reset() and boot with a new context.')
  }
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
    if (!identity || seen.has(identity))
      continue
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
}): string {
  const available = normalizeIdentityList(input.available)
  const requested = normalizeOptionalText(input.requested)
  if (requested && available.includes(requested))
    return requested

  if (requested && input.required)
    throw new Error(`[EndgeContext] ${input.label} "${requested}" was not found in loaded Domain`)

  const fallback = available[0]
  if (!fallback)
    throw new Error(`[EndgeContext] Cannot resolve ${input.label}: no available entities were loaded`)
  return fallback
}

function readLegacyThemePreference(): string | null {
  if (typeof localStorage === 'undefined')
    return null

  try {
    return normalizeOptionalText(localStorage.getItem(LEGACY_THEME_STORAGE_KEY))
  }
  catch {
    return null
  }
}
