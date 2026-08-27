import type { RAuthProfile } from '@/domain/entities/reflect/RAuthProfile'
import type {
  AuthAdapterContext,
  AuthProfileSchema,
  AuthProfileTestResult,
} from '@/domain/types/auth/auth-profile.types'

import type { AuthAdapterRegistry } from '@/model/modules/security/auth/AuthAdapterRegistry'
import { createEndgeAuthContext } from '@/model/services/auth/auth-context'

interface AuthProfileRegistryDependencies {
  listProfiles: () => RAuthProfile[]
  getDefaultIdentity: () => string | null
  resolveValue: (value: unknown) => string
  getSignal: () => AbortSignal | undefined
}

/** Читает persisted AuthProfile и проверяет adapter-specific contracts. */
export class AuthProfileRegistry {
  public constructor(
    private readonly _adapters: AuthAdapterRegistry,
    private readonly _dependencies: AuthProfileRegistryDependencies,
  ) {}

  /** Возвращает все persisted profiles. */
  public list(): AuthProfileSchema[] {
    return this._dependencies.listProfiles().map(profile => profile as AuthProfileSchema)
  }

  /** Возвращает profile по identity. */
  public get(identity: string): AuthProfileSchema | null {
    const normalized = String(identity ?? '').trim()
    return normalized
      ? this.list().find(profile => profile.identity === normalized) ?? null
      : null
  }

  /** Возвращает активный default profile или сообщает о повреждённой configuration. */
  public getDefault(): AuthProfileSchema | null {
    const identity = String(this._dependencies.getDefaultIdentity() ?? '').trim()
    if (!identity) {
      return null
    }
    const profile = this.get(identity)
    if (!profile) {
      throw new Error(`[EndgeAuth] Default auth profile is missing: ${identity}`)
    }
    this.requireActive(profile)
    return profile
  }

  /** Проверяет все не удалённые profiles текущего Domain. */
  public validateAll(): void {
    for (const profile of this.list()) {
      if (profile.deletedAt) {
        continue
      }
      this._validateCommon(profile)
      this._adapters.validate(profile)
    }
  }

  /** Проверяет profile в изолированной session без записи token в storage. */
  public async test(profile: AuthProfileSchema): Promise<AuthProfileTestResult> {
    this._validateCommon(profile)
    const adapter = this._adapters.require(profile)
    adapter.validate(profile)
    const context = this._adapterContext(profile)
    let token = await adapter.authenticate(context)
    let userInfo: Record<string, unknown> | null = null
    try {
      if (adapter.loadUserInfo) {
        userInfo = await adapter.loadUserInfo({ ...context, token })
      }
      const authContext = createEndgeAuthContext({
        authenticated: Boolean(token.accessToken) || Object.keys(token.headers ?? {}).length > 0,
        accessToken: token.accessToken,
        idToken: token.idToken,
        sessionState: token.sessionState,
        profileIdentity: profile.identity,
        userInfo,
      })
      return {
        authenticated: Boolean(token.accessToken) || Object.keys(token.headers ?? {}).length > 0,
        profileIdentity: profile.identity,
        expiresAt: token.accessExpiresAt,
        context: authContext,
        userInfo,
      }
    }
    finally {
      try {
        await adapter.logout?.({ ...context, token })
      }
      catch {
        // Profile test всегда остаётся ephemeral даже при недоступном logout endpoint.
      }
      token = { accessToken: '', accessExpiresAt: null }
    }
  }

  /** Требует существующий активный profile. */
  public requireActive(profileOrIdentity: AuthProfileSchema | string): AuthProfileSchema {
    const profile = typeof profileOrIdentity === 'string'
      ? this.get(profileOrIdentity)
      : profileOrIdentity
    if (!profile) {
      throw new Error(`[EndgeAuth] Auth profile is missing: ${String(profileOrIdentity)}`)
    }
    if (profile.active === false || profile.deletedAt) {
      throw new Error(`[EndgeAuth] Auth profile is inactive: ${profile.identity}`)
    }
    this._validateCommon(profile)
    this._adapters.validate(profile)
    return profile
  }

  /** Создаёт adapter context с opaque host credential resolver. */
  public createAdapterContext(profile: AuthProfileSchema): AuthAdapterContext {
    return this._adapterContext(profile)
  }

  private _adapterContext(profile: AuthProfileSchema): AuthAdapterContext {
    return {
      profile,
      signal: this._dependencies.getSignal(),
      resolveValue: value => this._dependencies.resolveValue(value),
      resolveCredential: async (credential: string): Promise<string> => {
        const raw = String(profile.credentials?.[credential] ?? '').trim()
        if (!raw) {
          throw new Error(`[EndgeAuth] credentials.${credential} is required: ${profile.identity}`)
        }
        const value = this._dependencies.resolveValue(raw)
        if (!value || (isVariableReference(raw) && value === raw)) {
          throw new Error(`[EndgeAuth] Credential is unavailable: ${profile.identity}.${credential}`)
        }
        return value
      },
    }
  }

  private _validateCommon(profile: AuthProfileSchema): void {
    if (!String(profile.identity ?? '').trim()) {
      throw new Error('[EndgeAuth] Auth profile identity is required')
    }
    if (!String(profile.adapterId ?? '').trim()) {
      throw new Error(`[EndgeAuth] Auth profile adapterId is required: ${profile.identity}`)
    }
    if (profile.session && !['localStorage', 'sessionStorage', 'memory'].includes(profile.session.storage)) {
      throw new Error(`[EndgeAuth] Auth profile session storage is invalid: ${profile.identity}`)
    }
  }
}

function isVariableReference(value: string): boolean {
  return /^\{[A-Z_][\w.-]*\}$/i.test(value)
}
