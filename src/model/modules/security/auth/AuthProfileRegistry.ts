import type { RAuthProfile } from '@/domain/entities/reflect/RAuthProfile'
import type {
  AuthAdapterContext,
  AuthProfileSchema,
  AuthProfileTestOptions,
  AuthProfileTestResult,
  EndgeAuthCredentialResolver,
} from '@/domain/types/auth/auth-profile.types'

import { createEndgeAuthContext } from '@/model/services/auth/auth-context'
import type { AuthAdapterRegistry } from '@/model/modules/security/auth/AuthAdapterRegistry'

interface AuthProfileRegistryDependencies {
  listProfiles: () => RAuthProfile[]
  getDefaultIdentity: () => string | null
  getCredentialResolver: () => EndgeAuthCredentialResolver | undefined
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
    if (!identity)
      return null
    const profile = this.get(identity)
    if (!profile)
      throw new Error(`[EndgeAuth] Default auth profile is missing: ${identity}`)
    this.requireActive(profile)
    return profile
  }

  /** Проверяет все не удалённые profiles текущего Domain. */
  public validateAll(): void {
    for (const profile of this.list()) {
      if (profile.deletedAt)
        continue
      this._validateCommon(profile)
      this._adapters.validate(profile)
    }
  }

  /** Проверяет profile в изолированной session без записи token в storage. */
  public async test(profile: AuthProfileSchema, options: AuthProfileTestOptions = {}): Promise<AuthProfileTestResult> {
    this._validateCommon(profile)
    const adapter = this._adapters.require(profile)
    adapter.validate(profile)
    const context = this._adapterContext(profile, options.credentials)
    let token = await adapter.authenticate(context)
    let userInfo: Record<string, unknown> | null = null
    try {
      if (adapter.loadUserInfo)
        userInfo = await adapter.loadUserInfo({ ...context, token })
      const authContext = createEndgeAuthContext({
        authenticated: Boolean(token.accessToken),
        accessToken: token.accessToken,
        idToken: token.idToken,
        sessionState: token.sessionState,
        profileIdentity: profile.identity,
        userInfo,
      })
      return {
        authenticated: Boolean(token.accessToken),
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
    if (!profile)
      throw new Error(`[EndgeAuth] Auth profile is missing: ${String(profileOrIdentity)}`)
    if (profile.active === false || profile.deletedAt)
      throw new Error(`[EndgeAuth] Auth profile is inactive: ${profile.identity}`)
    this._validateCommon(profile)
    this._adapters.validate(profile)
    return profile
  }

  /** Создаёт adapter context с opaque host credential resolver. */
  public createAdapterContext(profile: AuthProfileSchema, credentials?: Record<string, string>): AuthAdapterContext {
    return this._adapterContext(profile, credentials)
  }

  private _adapterContext(profile: AuthProfileSchema, credentials?: Record<string, string>): AuthAdapterContext {
    return {
      profile,
      credentials,
      signal: this._dependencies.getSignal(),
      resolveCredential: async (credential: string): Promise<string> => {
        const ref = String(profile.credentialRefs?.[credential] ?? '').trim()
        if (!ref)
          throw new Error(`[EndgeAuth] credentialRefs.${credential} is required: ${profile.identity}`)
        const resolver = this._dependencies.getCredentialResolver()
        if (!resolver)
          throw new Error(`[EndgeAuth] Host credential resolver is unavailable: ${profile.identity}.${credential}`)
        const value = String(await resolver({
          ref,
          profileIdentity: profile.identity,
          credential,
          signal: this._dependencies.getSignal(),
        }) ?? '').trim()
        if (!value)
          throw new Error(`[EndgeAuth] Credential is unavailable: ${profile.identity}.${credential}`)
        return value
      },
    }
  }

  private _validateCommon(profile: AuthProfileSchema): void {
    if (!String(profile.identity ?? '').trim())
      throw new Error('[EndgeAuth] Auth profile identity is required')
    if (!String(profile.adapterId ?? '').trim())
      throw new Error(`[EndgeAuth] Auth profile adapterId is required: ${profile.identity}`)
    if (!['localStorage', 'sessionStorage', 'memory'].includes(profile.persist))
      throw new Error(`[EndgeAuth] Auth profile persist is invalid: ${profile.identity}`)
  }
}
