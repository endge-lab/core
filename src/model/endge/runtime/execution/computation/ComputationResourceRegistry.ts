import type { ComputationResource as ComputationResourceContract } from '@/domain/types/computation'

import { ComputationResourceState } from './ComputationResource'

/** Host-owned registry that isolates resources by call site and row consumer key. */
export class ComputationResourceRegistry {
  private readonly resources = new Map<string, ComputationResourceState>()
  private readonly disposers = new Map<string, VoidFunction>()

  getOrCreate(
    key: string,
    input: unknown,
    create: () => ComputationResourceState,
    onChange?: VoidFunction,
  ): ComputationResourceContract {
    const existing = this.resources.get(key)
    if (existing) {
      existing.updateInput(input)
      return existing
    }
    const resource = create()
    this.resources.set(key, resource)
    if (onChange) this.disposers.set(key, resource.subscribe(onChange))
    return resource
  }

  dispose(): void {
    for (const dispose of this.disposers.values()) dispose()
    for (const resource of this.resources.values()) resource.dispose()
    this.disposers.clear()
    this.resources.clear()
  }
}
