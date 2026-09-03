import type { ComputationResourceState } from './ComputationResource'

import type {
  ComputationResource as ComputationResourceContract,
} from '@/modules/domain/types/computation/computation-runtime.types'

/** Host-owned registry that isolates resources by call site and row consumer key. */
export class ComputationResourceRegistry {
  private readonly _resources = new Map<string, ComputationResourceState>()
  private readonly _disposers = new Map<string, VoidFunction>()
  /** Resource inputs currently pulled by the active renderer pass. */
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
    if (onChange) {
      this._disposers.set(key, resource.subscribe(() => {
        if (!this._updatingInputs.has(key)) {
          onChange()
        }
      }))
    }
    return resource
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
    this._updatingInputs.clear()
  }
}
