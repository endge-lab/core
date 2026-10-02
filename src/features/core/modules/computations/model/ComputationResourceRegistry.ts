import type { ComputationResourceState } from './ComputationResource'

import type {
  ComputationResource as ComputationResourceContract,
} from '@/features/core/modules/domain/types/computation/computation-runtime.types'

/**
 * Принадлежащий host реестр, изолирующий ресурсы по месту вызова и ключу consumer строки.
 */
export class ComputationResourceRegistry {
  private readonly _resources = new Map<string, ComputationResourceState>()
  private readonly _scopeIndex = new Map<string, Set<string>>()
  private readonly _disposers = new Map<string, VoidFunction>()
  // Входы ресурсов, запрошенные текущим активным проходом renderer.
  private readonly _updatingInputs = new Set<string>()

  getOrCreate(
    key: string,
    input: unknown,
    create: () => ComputationResourceState,
    onChange?: VoidFunction,
  ): ComputationResourceContract {
    const existing = this._resources.get(key)
    if (existing) {
      const alreadyUpdating = this._updatingInputs.has(key)
      this._updatingInputs.add(key)
      try {
        existing.updateInput(input)
      }
      finally {
        if (!alreadyUpdating) {
          this._updatingInputs.delete(key)
        }
      }
      return existing
    }
    const resource = create()
    this._resources.set(key, resource)
    for (const scope of resourceScopes(key)) {
      let keys = this._scopeIndex.get(scope)
      if (!keys) {
        keys = new Set()
        this._scopeIndex.set(scope, keys)
      }
      keys.add(key)
    }
    if (onChange) {
      this._disposers.set(key, resource.subscribe(() => {
        if (!this._updatingInputs.has(key)) {
          onChange()
        }
      }))
    }
    return resource
  }

  /**
   * Renderer освобождает завершившихся consumers, не затрагивая соседние scopes.
   */
  releaseScope(scope: string, keep?: (key: string) => boolean): void {
    for (const key of this._scopeIndex.get(scope) ?? []) {
      if (keep?.(key)) {
        continue
      }
      this._disposers.get(key)?.()
      this._resources.get(key)?.dispose()
      this._disposers.delete(key)
      this._resources.delete(key)
      this._updatingInputs.delete(key)
      for (const indexedScope of resourceScopes(key)) {
        const keys = this._scopeIndex.get(indexedScope)
        keys?.delete(key)
        if (keys?.size === 0) {
          this._scopeIndex.delete(indexedScope)
        }
      }
    }
  }

  dispose(): void {
    for (const dispose of this._disposers.values()) {
      dispose()
    }
    for (const resource of this._resources.values()) {
      resource.dispose()
    }
    this._disposers.clear()
    this._resources.clear()
    this._scopeIndex.clear()
    this._updatingInputs.clear()
  }

  /**
   * Считывает ресурсы существующих consumers; новые вычисления не создаются.
   */
  snapshot() {
    return [...this._resources.values()].map(resource => resource.snapshot())
  }
}

function resourceScopes(key: string): string[] {
  const scopes = [key]
  for (let index = 1; index < key.length; index++) {
    if (key[index] === '/' || key[index] === ':') {
      scopes.push(key.slice(0, index))
    }
  }
  return scopes
}
