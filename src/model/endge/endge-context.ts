import type {
  EndgePersistenceDriver,
  EndgePersistenceOptions,
  EndgePersistenceScope,
  EndgeSessionIdentityProvider,
  EndgeStorageAdapter,
} from '@/domain/types/context-persistence.types'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { DEFAULT_ENDGE_WORKSPACE, normalizeWorkspaceLocale } from '@/model/config/endge-workspace'
import {
  EndgeStorageAdapterRegistry,
  normalizePersistence,
  type EndgePersistenceInput,
} from '@/model/endge/context/EndgeStorageAdapterRegistry'
import { RuntimeStateController } from '@/model/endge/context/RuntimeStateController'
import { DisabledContextAdapter } from '@/model/endge/context/adapters/DisabledContextAdapter'
import { LocalStorageContextAdapter } from '@/model/endge/context/adapters/LocalStorageContextAdapter'

const CONTEXT_STORAGE_KEY = 'endge:context:v1'
const LEGACY_CONTEXT_STORAGE_KEY = 'endge-context'

const DEFAULT_SCOPE: EndgePersistenceScope = {
  workspaceId: 'default',
  tenantId: 'default',
  projectId: 'default',
  environmentId: 'dev',
  userId: 'anonymous',
}

export interface EndgeContextSnapshot {
  workspace: string | null
  tenant: string | null
  project: string | null
  environment: string | null
  user: string | null
  locale: string | null
}

export interface EndgeContextPersistenceConfig {
  context?: EndgePersistenceDriver | EndgePersistenceOptions | null
}

/**
 * Контекст выполнения Endge: текущий workspace/project/environment/user scope
 * и координатор persistence-инфраструктуры приложения.
 */
export class EndgeContext extends EndgeModule {
  private readonly _adapters = new EndgeStorageAdapterRegistry()
  private readonly _runtimeControllers = new Map<string, RuntimeStateController>()

  private _contextPersistence: EndgePersistenceOptions = { driver: 'local' }
  private _currentWorkspace: string = DEFAULT_SCOPE.workspaceId
  private _currentTenant: string = DEFAULT_SCOPE.tenantId
  private _currentProject: string = DEFAULT_SCOPE.projectId
  private _currentEnvironment: string = DEFAULT_SCOPE.environmentId
  private _currentUser: string = DEFAULT_SCOPE.userId
  private _currentLocale: string = DEFAULT_ENDGE_WORKSPACE.defaultLocale
  private _pendingLocale: string | null = null
  private _sessionProvider: EndgeSessionIdentityProvider | null = null
  private _isHydrating = false

  public constructor() {
    super()
    this.registerStorageAdapter(new LocalStorageContextAdapter())
    this.registerStorageAdapter(new DisabledContextAdapter())
    this.loadFromStorage()
  }

  get isLoadingFromStorage(): boolean {
    return this._isHydrating
  }

  public registerStorageAdapter(adapter: EndgeStorageAdapter): void {
    this._adapters.register(adapter)
  }

  public configurePersistence(config: EndgeContextPersistenceConfig): void {
    if (config.context == null) {
      return
    }

    this._contextPersistence = normalizePersistence(config.context)
    this.saveToStorage()
  }

  public setSessionIdentityProvider(provider: EndgeSessionIdentityProvider | null): void {
    this._sessionProvider = provider
    this.notify()
  }

  public override serialize(): EndgeContextSnapshot {
    return {
      workspace: this._currentWorkspace,
      tenant: this._currentTenant,
      project: this._currentProject,
      environment: this._currentEnvironment,
      user: this._currentUser,
      locale: this._currentLocale || null,
    }
  }

  public override deserialize(payload: Partial<EndgeContextSnapshot> | undefined): void {
    this._currentWorkspace = normalizeScopePart(payload?.workspace, DEFAULT_SCOPE.workspaceId)
    this._currentTenant = normalizeScopePart(payload?.tenant, DEFAULT_SCOPE.tenantId)
    this._currentProject = normalizeScopePart(payload?.project, DEFAULT_SCOPE.projectId)
    this._currentEnvironment = normalizeScopePart(payload?.environment, DEFAULT_SCOPE.environmentId)
    this._currentUser = normalizeScopePart(payload?.user, DEFAULT_SCOPE.userId)
    const rawLocale = normalizeOptionalText(payload?.locale)
    const locale = normalizeWorkspaceLocale(rawLocale)
    this._currentLocale = locale
    this._pendingLocale = rawLocale && rawLocale !== locale ? rawLocale : null
  }

  public saveToStorage(): void {
    if (this._isHydrating) {
      return
    }

    try {
      this.resolveAdapter(this._contextPersistence).write(CONTEXT_STORAGE_KEY, this.serialize())
    }
    catch {
      /* ignore */
    }
  }

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

  public getPersistenceScope(): EndgePersistenceScope {
    const session = this.resolveSessionIdentity()

    return {
      workspaceId: this._currentWorkspace,
      tenantId: session.tenantId,
      projectId: this._currentProject,
      environmentId: this._currentEnvironment,
      userId: session.userId,
    }
  }

  public createRuntimeStateController(input: {
    runtimeId: string
    persistence?: EndgePersistenceInput
  }): RuntimeStateController {
    const runtimeId = normalizeRequiredScopePart(input.runtimeId, 'runtimeId')
    const existing = this._runtimeControllers.get(runtimeId)
    if (existing) {
      return existing
    }

    const controller = new RuntimeStateController({
      runtimeId,
      scope: this.getPersistenceScope(),
      adapter: this.resolveAdapter(input.persistence ?? { driver: 'local' }),
    })
    this._runtimeControllers.set(runtimeId, controller)
    return controller
  }

  public getRuntimeStateController(runtimeId: string): RuntimeStateController | null {
    return this._runtimeControllers.get(String(runtimeId ?? '').trim()) ?? null
  }

  public destroyRuntimeStateController(runtimeId: string): void {
    this._runtimeControllers.delete(String(runtimeId ?? '').trim())
  }

  public getCurrentWorkspace(): string {
    return this._currentWorkspace
  }

  public setCurrentWorkspace(identity: string | null): void {
    this.setScopeValue('_currentWorkspace', identity, DEFAULT_SCOPE.workspaceId)
  }

  public getCurrentTenant(): string {
    return this.resolveSessionIdentity().tenantId
  }

  public setCurrentTenant(identity: string | null): void {
    this.setScopeValue('_currentTenant', identity, DEFAULT_SCOPE.tenantId)
  }

  public getCurrentProject(): string {
    return this._currentProject
  }

  public setCurrentProject(identity: string | null): void {
    this.setScopeValue('_currentProject', identity, DEFAULT_SCOPE.projectId)
  }

  public getCurrentEnvironment(): string {
    return this._currentEnvironment
  }

  public setCurrentEnvironment(identity: string | null): void {
    this.setScopeValue('_currentEnvironment', identity, DEFAULT_SCOPE.environmentId)
  }

  public getCurrentUser(): string {
    return this.resolveSessionIdentity().userId
  }

  public setCurrentUser(identity: string | null): void {
    this.setScopeValue('_currentUser', identity, DEFAULT_SCOPE.userId)
  }

  get currentLocale(): string {
    return this._currentLocale || DEFAULT_ENDGE_WORKSPACE.defaultLocale
  }

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

  public setCurrentLocale(locale: string | null): void {
    this.currentLocale = normalizeWorkspaceLocale(locale)
  }

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

  private resolveAdapter(persistence: EndgePersistenceInput): EndgeStorageAdapter {
    return this._adapters.resolve(persistence)
  }

  private resolveSessionIdentity(): { tenantId: string, userId: string } {
    const external = this._sessionProvider?.getCurrentIdentity() ?? null

    return {
      tenantId: normalizeScopePart(external?.tenantId ?? this._currentTenant, DEFAULT_SCOPE.tenantId),
      userId: normalizeScopePart(external?.userId ?? this._currentUser, DEFAULT_SCOPE.userId),
    }
  }

  private setScopeValue(
    field: '_currentWorkspace' | '_currentTenant' | '_currentProject' | '_currentEnvironment' | '_currentUser',
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
