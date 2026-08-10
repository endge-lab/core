import type { EndgeBootContext } from '@/domain/types/kernel/bootstrap.types'
import type { DiagnosticsAttributes } from '@/domain/types/diagnostics/diagnostics.types'
import type { EndgeAuthCredentialResolver } from '@/domain/types/auth/auth-profile.types'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { Endge } from '@/model/kernel/endge'
import { AuthAdapterRegistry } from '@/model/modules/security/auth/AuthAdapterRegistry'
import { AuthProfileRegistry } from '@/model/modules/security/auth/AuthProfileRegistry'
import { AuthRequestResolver } from '@/model/modules/security/auth/AuthRequestResolver'
import { AuthSessionManager } from '@/model/modules/security/auth/AuthSessionManager'
import { AuthSessionStore } from '@/model/modules/security/auth/AuthSessionStore'
import { BearerAuthAdapter } from '@/model/modules/security/auth/adapters/BearerAuthAdapter'
import { KeycloakAuthAdapter } from '@/model/modules/security/auth/adapters/KeycloakAuthAdapter'

/** Единый lifecycle owner application session и request authentication. */
export class EndgeAuth extends EndgeModule {
  public readonly adapters: AuthAdapterRegistry
  public readonly profiles: AuthProfileRegistry
  public readonly session: AuthSessionManager
  public readonly requests: AuthRequestResolver

  private _credentialResolver: EndgeAuthCredentialResolver | undefined
  private _signal: AbortSignal | undefined
  private _abortController: AbortController | null = null
  private _detachHostAbort: (() => void) | null = null
  private _unregisterDiagnosticsContext: (() => void) | null = null

  /** Собирает auth subsystem и регистрирует встроенные adapters один раз. */
  public constructor() {
    super()
    this.adapters = new AuthAdapterRegistry()
    this.adapters.register(new BearerAuthAdapter())
    this.adapters.register(new KeycloakAuthAdapter(raw => this._resolvePublicValue(raw)))

    this.profiles = new AuthProfileRegistry(this.adapters, {
      listProfiles: () => Endge.domain.getAuthProfiles(),
      getDefaultIdentity: () => Endge.workspace.defaultAuthProfileIdentity,
      getCredentialResolver: () => this._credentialResolver,
      getSignal: () => this._signal,
    })

    const store = new AuthSessionStore()
    this.session = new AuthSessionManager(this.profiles, this.adapters, store, {
      getWorkspaceIdentity: () => Endge.context.getCurrentWorkspace() ?? '',
      onApplicationSessionChange: () => this.notify(),
    })
    this.requests = new AuthRequestResolver(this.profiles, this.session)
  }

  /** Подключает host credential port и безопасные context providers. */
  public override setup(ctx: EndgeBootContext): void {
    this._credentialResolver = ctx.auth?.resolveCredential
    this._abortController?.abort()
    this._detachHostAbort?.()
    const controller = new AbortController()
    this._abortController = controller
    this._signal = controller.signal
    if (ctx.signal) {
      const abort = (): void => controller.abort(ctx.signal?.reason)
      if (ctx.signal.aborted)
        abort()
      else
        ctx.signal.addEventListener('abort', abort, { once: true })
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

  /** Валидирует Domain profiles и восстанавливает default application session. */
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
    this._credentialResolver = undefined
    this._signal = undefined
    this._unregisterDiagnosticsContext?.()
    this._unregisterDiagnosticsContext = null
    Endge.context.setSessionIdentityProvider(null)
    this.notify()
  }

  private _resolvePublicValue(raw: unknown): string {
    const value = String(raw ?? '').trim()
    if (!value)
      return ''
    return String(Endge.workspace.variables.resolve(value, {
      fallback: value,
      onInvalid: 'as-is',
    }) ?? value).trim()
  }

  private _diagnosticsAttributes(): DiagnosticsAttributes {
    const context = this.session.context
    if (!context.authenticated)
      return {}
    return {
      ...(context.subject ? { 'user.id': context.subject } : {}),
      ...(context.sessionId ? { 'session.id': context.sessionId } : {}),
      ...(context.profileIdentity ? { 'endge.auth.profile.id': context.profileIdentity } : {}),
    }
  }
}
