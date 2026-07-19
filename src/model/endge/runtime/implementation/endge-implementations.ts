import type {
  ImplementationBinding,
  ImplementationInvocation,
  ImplementationContract,
  ImplementationProvider,
  ImplementationResolutionRequest,
  ImplementationSnapshot,
  ResolvedImplementation,
} from '@/domain/types/runtime/implementation.types'
import { ImplementationError } from '@/domain/types/runtime/implementation.types'
import { ImplementationBindingRegistry } from '@/model/endge/runtime/implementation/implementation-binding-registry'
import { ImplementationProviderRegistry } from '@/model/endge/runtime/implementation/implementation-provider-registry'

/** Generic runtime module for code providers, bindings and effective resolution. */
export class EndgeImplementations {
  private readonly _providers = new ImplementationProviderRegistry()
  private readonly _bindings = new ImplementationBindingRegistry()

  /** Registers local executable code and returns its disposer. */
  public registerProvider(provider: ImplementationProvider): () => void {
    return this._providers.register(provider)
  }

  /** Registers an explicit binding and returns its disposer. */
  public bind(binding: ImplementationBinding): () => void {
    return this._bindings.register(binding)
  }

  /** Resolves the effective provider by scope and priority. */
  public resolve(request: ImplementationResolutionRequest): ResolvedImplementation {
    if (request.invocationProviderKey) {
      const provider = this._requireProvider(request.invocationProviderKey)
      this._assertCompatibleContract(provider, request)
      return {
        provider,
        binding: null,
        scope: 'invocation',
      }
    }
    const binding = this._bindings.resolve(request)
    const providerKey = binding?.providerKey ?? request.defaultProviderKey
    if (!providerKey) {
      throw new ImplementationError(
        'implementation-provider-missing',
        `No implementation for ${request.executable.type}:${request.executable.identity}.`,
      )
    }
    const provider = this._requireProvider(providerKey)
    this._assertCompatibleContract(provider, request)
    return {
      provider,
      binding,
      scope: binding?.scope ?? 'default',
    }
  }

  /** Resolves and executes one invocation through its effective provider. */
  public async execute<TResult = unknown>(
    request: ImplementationResolutionRequest,
    invocation: ImplementationInvocation,
  ): Promise<TResult> {
    const resolved = this.resolve(request)
    if (resolved.provider.canExecute && !resolved.provider.canExecute(invocation)) {
      throw new ImplementationError(
        'implementation-cannot-execute',
        `Provider cannot execute ${invocation.executable.type}:${invocation.executable.identity}.`,
      )
    }
    return await resolved.provider.execute(invocation) as TResult
  }

  /** Returns a serializable inspection snapshot without functions. */
  public snapshot(): ImplementationSnapshot {
    return {
      providers: this._providers.list().map(provider => ({
        key: provider.key,
        active: provider.active !== false,
        origin: provider.origin,
      })),
      bindings: this._bindings.list(),
    }
  }

  public clear(): void {
    this._bindings.clear()
    this._providers.clear()
  }

  private _requireProvider(key: string): ImplementationProvider {
    const provider = this._providers.get(key)
    if (!provider)
      throw new ImplementationError('implementation-provider-missing', `Implementation provider is not registered: ${key}.`)
    if (provider.active === false)
      throw new ImplementationError('implementation-provider-inactive', `Implementation provider is inactive: ${key}.`)
    return provider
  }

  private _assertCompatibleContract(
    provider: ImplementationProvider,
    request: ImplementationResolutionRequest,
  ): void {
    if (!provider.contract || !request.expectedContract)
      return
    if (stableContract(provider.contract) === stableContract(request.expectedContract))
      return
    throw new ImplementationError(
      'implementation-contract-incompatible',
      `Provider contract is incompatible with ${request.executable.type}:${request.executable.identity}.`,
    )
  }
}

function stableContract(contract: ImplementationContract): string {
  const field = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value ?? null
    const raw = value as Record<string, unknown>
    return {
      name: raw.name ?? null,
      type: raw.type ?? null,
      isArray: raw.isArray === true,
      optional: raw.optional === true,
    }
  }
  const target = Array.isArray(contract.target)
    ? contract.target.map((selector: any) => ({ type: selector.type, identity: selector.identity ?? null }))
      .sort((left: any, right: any) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    : null
  return JSON.stringify({ target, input: field(contract.input), output: field(contract.output) })
}
