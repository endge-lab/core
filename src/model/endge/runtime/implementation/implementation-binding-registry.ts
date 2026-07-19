import type {
  ImplementationBinding,
  ImplementationResolutionRequest,
} from '@/domain/types/runtime/implementation.types'
import { ImplementationError } from '@/domain/types/runtime/implementation.types'

const SCOPE_WEIGHT = {
  application: 1,
  workspace: 2,
  composition: 3,
  component: 4,
  invocation: 5,
} as const

/** Resolves explicit bindings without relying on registration order. */
export class ImplementationBindingRegistry {
  private readonly _bindings = new Set<ImplementationBinding>()

  public register(binding: ImplementationBinding): () => void {
    const normalized: ImplementationBinding = {
      ...binding,
      executableType: String(binding.executableType ?? '').trim(),
      executableIdentity: String(binding.executableIdentity ?? '').trim(),
      providerKey: String(binding.providerKey ?? '').trim(),
      scopeIdentity: String(binding.scopeIdentity ?? '').trim() || undefined,
      priority: Number(binding.priority ?? 0) || 0,
    }
    if (!normalized.executableType || !normalized.executableIdentity || !normalized.providerKey)
      throw new Error('Implementation binding requires executable type, identity and provider key.')
    this._bindings.add(normalized)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this._bindings.delete(normalized)
    }
  }

  public resolve(request: ImplementationResolutionRequest): ImplementationBinding | null {
    const candidates = [...this._bindings].filter((binding) => {
      if (binding.executableType !== request.executable.type || binding.executableIdentity !== request.executable.identity)
        return false
      const requestedScopeIdentity = request.scopeIdentities?.[binding.scope]
      return binding.scopeIdentity == null || binding.scopeIdentity === requestedScopeIdentity
    })
    if (candidates.length === 0)
      return null

    const highestScope = Math.max(...candidates.map(binding => SCOPE_WEIGHT[binding.scope]))
    const atScope = candidates.filter(binding => SCOPE_WEIGHT[binding.scope] === highestScope)
    const highestPriority = Math.max(...atScope.map(binding => binding.priority ?? 0))
    const winners = atScope.filter(binding => (binding.priority ?? 0) === highestPriority)
    if (winners.length !== 1) {
      throw new ImplementationError(
        'implementation-binding-ambiguous',
        `Ambiguous implementation bindings for ${request.executable.type}:${request.executable.identity}.`,
      )
    }
    return winners[0]
  }

  public list(): ImplementationBinding[] {
    return [...this._bindings].map(binding => ({ ...binding }))
  }

  public clear(): void {
    this._bindings.clear()
  }
}
