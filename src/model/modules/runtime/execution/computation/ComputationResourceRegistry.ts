import type {
  ComputationResource as ComputationResourceContract,
} from '@/domain/types/computation/computation-runtime.types'

import { ComputationResourceState } from './ComputationResource'

/** Host-owned registry that isolates resources by call site and row consumer key. */
export class ComputationResourceRegistry {
  private readonly resources = new Map<string, ComputationResourceState>()
  private readonly disposers = new Map<string, VoidFunction>()
  /** Resource inputs currently pulled by the active renderer pass. */
  private readonly _updatingInputs = new Set<string>()

  getOrCreate(
    key: string,
    input: unknown,
    create: () => ComputationResourceState,
    onChange?: VoidFunction,
  ): ComputationResourceContract {
    const existing = this.resources.get(key)
    if (existing) {
      const alreadyUpdating = this._updatingInputs.has(key)
      this._updatingInputs.add(key)
      try {
        existing.updateInput(input)
      }
      finally {
        if (!alreadyUpdating)
          this._updatingInputs.delete(key)
      }
      return existing
    }
    const resource = create()
    this.resources.set(key, resource)
    if (onChange) {
      this.disposers.set(key, resource.subscribe(() => {
        if (!this._updatingInputs.has(key))
          onChange()
      }))
    }
    return resource
  }

  dispose(): void {
    for (const dispose of this.disposers.values()) dispose()
    for (const resource of this.resources.values()) resource.dispose()
    this.disposers.clear()
    this.resources.clear()
    this._updatingInputs.clear()
  }
}
