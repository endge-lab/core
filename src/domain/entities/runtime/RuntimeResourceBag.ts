import type { RuntimeOwnedResource, RuntimeResourceBagSnapshot } from '@/domain/types/runtime/runtime-resource.types'

/** Владеет disposable runtime resources и освобождает их в обратном порядке. */
export class RuntimeResourceBag {
  private readonly _resources = new Map<string, RuntimeOwnedResource>()
  private _paused = false

  public add<T extends RuntimeOwnedResource>(resource: T): T {
    const id = String(resource.id ?? '').trim()
    if (!id)
      throw new Error('[RuntimeResourceBag] Resource id is required.')
    if (this._resources.has(id))
      throw new Error(`[RuntimeResourceBag] Resource "${id}" is already owned.`)
    this._resources.set(id, resource)
    return resource
  }

  public has(id: string): boolean {
    return this._resources.has(String(id ?? '').trim())
  }

  public async pause(): Promise<void> {
    if (this._paused)
      return
    const resources = [...this._resources.values()].reverse()
    const errors: unknown[] = []
    for (const resource of resources) {
      try {
        await resource.pause?.()
      }
      catch (error) {
        errors.push(error)
      }
    }
    this._paused = true
    if (errors.length)
      throw new AggregateError(errors, '[RuntimeResourceBag] Failed to pause resources.')
  }

  public async resume(): Promise<void> {
    if (!this._paused)
      return
    const resumed: RuntimeOwnedResource[] = []
    try {
      for (const resource of this._resources.values()) {
        await resource.resume?.()
        resumed.push(resource)
      }
      this._paused = false
    }
    catch (error) {
      for (const resource of resumed.reverse()) {
        try {
          await resource.pause?.()
        }
        catch {}
      }
      throw error
    }
  }

  public async dispose(): Promise<void> {
    const resources = [...this._resources.values()].reverse()
    this._resources.clear()
    this._paused = false
    const errors: unknown[] = []
    for (const resource of resources) {
      try {
        await resource.dispose()
      }
      catch (error) {
        errors.push(error)
      }
    }
    if (errors.length)
      throw new AggregateError(errors, '[RuntimeResourceBag] Failed to dispose resources.')
  }

  public snapshot(): RuntimeResourceBagSnapshot {
    return {
      total: this._resources.size,
      paused: this._paused,
      resources: [...this._resources.values()].map(resource => ({ id: resource.id, kind: resource.kind })),
    }
  }
}
