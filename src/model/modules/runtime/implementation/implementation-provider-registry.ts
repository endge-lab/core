import type { ImplementationProvider } from '@/domain/types/runtime/implementation.types'
import { ImplementationError } from '@/domain/types/runtime/implementation.types'

/** Owns executable provider functions; providers are never persisted. */
export class ImplementationProviderRegistry {
  private readonly _providers = new Map<string, ImplementationProvider>()

  public register(provider: ImplementationProvider): () => void {
    const key = String(provider.key ?? '').trim()
    if (!key)
      throw new ImplementationError('implementation-provider-missing', 'Implementation provider key is required.')
    if (this._providers.has(key))
      throw new ImplementationError('implementation-binding-ambiguous', `Implementation provider already exists: ${key}.`)
    const normalized = { ...provider, key }
    this._providers.set(key, normalized)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      if (this._providers.get(key) === normalized)
        this._providers.delete(key)
    }
  }

  public get(key: string): ImplementationProvider | null {
    return this._providers.get(String(key ?? '').trim()) ?? null
  }

  public list(): ImplementationProvider[] {
    return [...this._providers.values()]
  }

  public clear(): void {
    this._providers.clear()
  }
}
