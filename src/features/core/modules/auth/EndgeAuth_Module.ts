import type { EndgeBootContext } from '@/features/core/kernel/types/bootstrap.types'
import type { AuthInteractionRequiredError } from '@/features/core/modules/auth/domain/AuthInteractionRequiredError'
import type { AuthProfileSchema, OidcBrowserSessionOptions } from '@/features/core/modules/auth/domain/types/auth-profile.types'

import type { DiagnosticsAttributes } from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'
import { Endge } from '@/features/core/kernel/endge'
import { BasicAuthAdapter } from '@/features/core/modules/auth/adapters/BasicAuthAdapter'
import { BearerAuthAdapter } from '@/features/core/modules/auth/adapters/BearerAuthAdapter'
import { OAuth2ClientCredentialsAuthAdapter } from '@/features/core/modules/auth/adapters/OAuth2ClientCredentialsAuthAdapter'
import { OAuth2PasswordAuthAdapter } from '@/features/core/modules/auth/adapters/OAuth2PasswordAuthAdapter'
import { OidcAuthAdapter } from '@/features/core/modules/auth/adapters/OidcAuthAdapter'
import { OidcBrowserSession_Adapter } from '@/features/core/modules/auth/adapters/OidcBrowserSession_Adapter'
import { AuthAdapterRegistry } from '@/features/core/modules/auth/services/AuthAdapterRegistry'
import { AuthProfileRegistry } from '@/features/core/modules/auth/services/AuthProfileRegistry'
import { AuthRequestResolver } from '@/features/core/modules/auth/services/AuthRequestResolver'
import { AuthSessionManager } from '@/features/core/modules/auth/services/AuthSessionManager'
import { AuthSessionStore } from '@/features/core/modules/auth/services/AuthSessionStore'
import { EndgeModule } from '@/features/federation/EndgeModule'

export type AuthInteractionRequiredListener = (error: AuthInteractionRequiredError) => void

/** Единый lifecycle owner runtime auth profile sessions и request authentication. */
export class EndgeAuth_Module extends EndgeModule {
  public readonly adapters: AuthAdapterRegistry
  public readonly profiles: AuthProfileRegistry
  public readonly session: AuthSessionManager
  public readonly requests: AuthRequestResolver

  private _signal: AbortSignal | undefined
  private _storageNamespace = 'default'
  private _abortController: AbortController | null = null
  private _detachHostAbort: (() => void) | null = null
  private _unregisterDiagnosticsContext: (() => void) | null = null
  private readonly _store: AuthSessionStore
  private readonly _interactionRequiredListeners = new Set<AuthInteractionRequiredListener>()

  /** Собирает auth subsystem и регистрирует встроенные adapters один раз. */
  public constructor() {
    super()
    this.adapters = new AuthAdapterRegistry()
    this.adapters.register(new OidcAuthAdapter())
    this.adapters.register(new OAuth2ClientCredentialsAuthAdapter())
    this.adapters.register(new OAuth2PasswordAuthAdapter())
    this.adapters.register(new BasicAuthAdapter())
    this.adapters.register(new BearerAuthAdapter())

    this.profiles = new AuthProfileRegistry(this.adapters, {
      listProfiles: () => Endge.domain.getAuthProfiles(),
      getDefaultIdentity: () => Endge.workspace.defaultAuthProfileIdentity,
      resolveValue: value => this._resolvePublicValue(value),
      getSignal: () => this._signal,
    })

    this._store = new AuthSessionStore()
    this.session = new AuthSessionManager(this.profiles, this.adapters, this._store, {
      getWorkspaceIdentity: () => Endge.context.getCurrentWorkspace() ?? '',
      onSessionChange: () => this.notify(),
    })
    this.requests = new AuthRequestResolver(
      this.profiles,
      this.session,
      error => this._publishInteractionRequired(error),
    )
  }

  /** Подписывает host-приложение на запросы, требующие интерактивного OIDC flow. */
  public onInteractionRequired(listener: AuthInteractionRequiredListener): () => void {
    this._interactionRequiredListeners.add(listener)
    return () => this._interactionRequiredListeners.delete(listener)
  }

  /** Подключает storage namespace и безопасные context providers. */
  public override setup(ctx: EndgeBootContext): void {
    this._storageNamespace = String(ctx.auth?.storageNamespace ?? '').trim() || 'default'
    this._store.setNamespace(this._storageNamespace)
    this._abortController?.abort()
    this._detachHostAbort?.()
    const controller = new AbortController()
    this._abortController = controller
    this._signal = controller.signal
    if (ctx.signal) {
      const abort = (): void => controller.abort(ctx.signal?.reason)
      if (ctx.signal.aborted) {
        abort()
      }
      else { ctx.signal.addEventListener('abort', abort, { once: true }) }
      this._detachHostAbort = () => ctx.signal?.removeEventListener('abort', abort)
    }
    this._unregisterDiagnosticsContext?.()
    this._unregisterDiagnosticsContext = Endge.diagnostics.registerContextProvider(
      'auth',
      () => this._diagnosticsAttributes(),
    )
    Endge.context.setSessionIdentityProvider({
      getCurrentIdentity: () => ({
        userId: this.session.context.subject ?? null,
      }),
    })
  }

  /** Валидирует Domain profiles и восстанавливает session default runtime profile. */
  public override build(): void {
    this.profiles.validateAll()
    this.session.configureDefault(this.profiles.getDefault())
    this.notify()
  }

  /** Сбрасывает runtime state, не удаляя persisted browser session. */
  public override reset(): void {
    this._abortController?.abort()
    this._abortController = null
    this._detachHostAbort?.()
    this._detachHostAbort = null
    this.session.resetRuntime()
    this._store.setNamespace(undefined)
    this._storageNamespace = 'default'
    this._signal = undefined
    this._unregisterDiagnosticsContext?.()
    this._unregisterDiagnosticsContext = null
    Endge.context.setSessionIdentityProvider(null)
    this.notify()
  }

  /** Создаёт OIDC browser source из resolved persisted profile. */
  public createOidcSessionSource(
    profileInput: AuthProfileSchema | string,
    options: Pick<OidcBrowserSessionOptions, 'redirectUri' | 'popupRedirectUri' | 'postLogoutRedirectUri' | 'flow'>,
  ): OidcBrowserSession_Adapter {
    const profile = this.profiles.requireActive(profileInput)
    if (profile.adapterId !== 'oidc' || !profile.session) {
      throw new Error(`[EndgeAuth] Profile does not support OIDC browser flow: ${profile.identity}`)
    }
    const issuer = this._resolvePublicValue(profile.config.issuer)
    const clientId = this._resolvePublicValue(profile.config.clientId)
    const scopes = Array.isArray(profile.config.scopes)
      ? profile.config.scopes.map(scope => this._resolvePublicValue(scope)).filter(Boolean)
      : []
    if (!issuer || !clientId || scopes.length === 0) {
      throw new Error(`[EndgeAuth] OIDC public config is unresolved: ${profile.identity}`)
    }
    return new OidcBrowserSession_Adapter({
      issuer,
      clientId,
      scopes,
      session: profile.session,
      storageNamespace: `${this._storageNamespace}:${Endge.context.getCurrentWorkspace() ?? 'workspace'}`,
      profileIdentity: profile.identity,
      ...options,
    })
  }

  private _resolvePublicValue(raw: unknown): string {
    const value = String(raw ?? '').trim()
    if (!value) {
      return ''
    }
    const resolved = String(Endge.workspace.variables.resolve(value, {
      fallback: value,
      onInvalid: 'as-is',
    }) ?? value).trim()
    if (isVariableReference(value) && (!resolved || resolved === value)) {
      throw new Error(`[EndgeAuth] Workspace variable is unavailable: ${value}`)
    }
    return resolved
  }

  private _diagnosticsAttributes(): DiagnosticsAttributes {
    const context = this.session.context
    if (!context.authenticated) {
      return {}
    }
    return {
      ...(context.subject ? { 'user.id': context.subject } : {}),
      ...(context.sessionId ? { 'session.id': context.sessionId } : {}),
      ...(context.profileIdentity ? { 'endge.auth.profile.id': context.profileIdentity } : {}),
    }
  }

  private _publishInteractionRequired(error: AuthInteractionRequiredError): void {
    for (const listener of [...this._interactionRequiredListeners]) {
      try {
        listener(error)
      }
      catch {
        // A host listener must not replace the original typed request error.
      }
    }
  }
}

function isVariableReference(value: string): boolean {
  return /^\{[A-Z_][\w.-]*\}$/i.test(value)
}
