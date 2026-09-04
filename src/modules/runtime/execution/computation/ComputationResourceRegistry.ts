import type { ComputationResourceState } from './ComputationResource'

import type {
  ComputationResource as ComputationResourceContract,
} from '@/modules/domain/types/computation/computation-runtime.types'

/** Принадлежащий host реестр, изолирующий ресурсы по месту вызова и ключу consumer строки. */
export class ComputationResourceRegistry {
  private readonly _resources = new Map<string, ComputationResourceState>()
  private readonly _disposers = new Map<string, VoidFunction>()
  /** Входы ресурсов, запрошенные текущим активным проходом renderer. */
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
