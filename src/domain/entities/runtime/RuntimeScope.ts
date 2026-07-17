import type { RuntimeHost } from '@/domain/types/runtime/runtime-host.types'
import type {
  RuntimeScopeHandle,
  RuntimeScopeLifecycleHooks,
  RuntimeScopeSnapshot,
  RuntimeScopeState,
} from '@/domain/types/runtime/runtime-scope.types'

import { RuntimeResourceBag } from '@/domain/entities/runtime/RuntimeResourceBag'

export interface RuntimeScopeOptions {
  id: string
  path: string
  boundaryId?: string
  parent?: RuntimeScope | null
  ownerRuntimeId?: string | null
  hooks?: RuntimeScopeLifecycleHooks
}

/** Runtime lifecycle owner для hosts, nested scopes и disposable resources. */
export class RuntimeScope implements RuntimeScopeHandle {
  public readonly id: string
  public readonly path: string
  public readonly boundaryId: string
  public readonly parent: RuntimeScope | null
  public readonly ownerRuntimeId: string | null
  public readonly resources = new RuntimeResourceBag()
  public state: RuntimeScopeState = 'inactive'

  private readonly _hooks: RuntimeScopeLifecycleHooks
  private readonly _children = new Map<string, RuntimeScope>()
  private readonly _members = new Map<string, RuntimeHost<any, any>>()
  private _transition: Promise<void> = Promise.resolve()
  private _generation = 0
  private _abortController: AbortController | null = null
  private _updateGateOpen = false
  private _stale = false
  private _lastError: string | null = null
  private _activeChildrenBeforePause = new Set<string>()
  private readonly _listeners = new Set<() => void>()

  public constructor(options: RuntimeScopeOptions) {
    this.id = required(options.id, 'id')
    this.path = required(options.path, 'path')
    this.boundaryId = required(options.boundaryId ?? options.id, 'boundaryId')
    this.parent = options.parent ?? null
    this.ownerRuntimeId = options.ownerRuntimeId ?? null
    this._hooks = options.hooks ?? {}
    this.parent?._children.set(this.id, this)
  }

  public get generation(): number { return this._generation }
  public get updateGateOpen(): boolean { return this._updateGateOpen }
  public get stale(): boolean { return this._stale }

  public subscribe(listener: () => void): () => void {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  public activate(): Promise<void> {
    return this._enqueue(async () => {
      if (this.state === 'active') return
      if (this.state === 'paused') return this._resume()
      this._assertNotDisposed('activate')
      if (this.state !== 'inactive' && this.state !== 'error')
        throw new Error(`[RuntimeScope] Cannot activate "${this.path}" from ${this.state}.`)
      if (this.parent && this.parent.state !== 'active' && this.parent.state !== 'activating')
        await this.parent.activate()
      this._setState('activating')
      this._lastError = null
      this._generation += 1
      this._abortController?.abort()
      this._abortController = new AbortController()
      try {
        await waitForAbortable(
          this._hooks.activate?.(this._abortController.signal, this._generation),
          this._abortController.signal,
        )
        this._updateGateOpen = true
        this._stale = false
        this._setState('active')
      }
      catch (error) {
        this._abortController.abort()
        await this._safeDeactivate()
        this._setError(error)
        throw error
      }
    })
  }

  public pause(): Promise<void> {
    return this._enqueue(async () => {
      if (this.state === 'paused' || this.state === 'inactive') return
      this._assertNotDisposed('pause')
      if (this.state !== 'active')
        throw new Error(`[RuntimeScope] Cannot pause "${this.path}" from ${this.state}.`)
      this._setState('pausing')
      this._updateGateOpen = false
      this._abortController?.abort()
      this._activeChildrenBeforePause = new Set(
        [...this._children.values()].filter(child => child.state === 'active').map(child => child.id),
      )
      try {
        for (const child of [...this._children.values()].reverse())
          await child.pause()
        for (const host of [...this._members.values()].reverse())
          await host.pause?.()
        await this._hooks.pause?.()
        await this.resources.pause()
        this._setState('paused')
      }
      catch (error) {
        this._setError(error)
        throw error
      }
    })
  }

  public resume(): Promise<void> {
    return this._enqueue(() => this._resume())
  }

  public deactivate(): Promise<void> {
    this._abortController?.abort()
    return this._enqueue(async () => {
      if (this.state === 'inactive') return
      this._assertNotDisposed('deactivate')
      this._setState('deactivating')
      this._updateGateOpen = false
      this._generation += 1
      this._abortController?.abort()
      await this._safeDeactivate()
      this._setState('inactive')
      this._stale = false
      this._activeChildrenBeforePause.clear()
    })
  }

  public dispose(): Promise<void> {
    this._abortController?.abort()
    return this._enqueue(async () => {
      if (this.state === 'disposed') return
      if (this.state !== 'inactive') {
        this._setState('deactivating')
        this._updateGateOpen = false
        this._abortController?.abort()
        await this._safeDeactivate()
      }
      for (const child of [...this._children.values()].reverse())
        await child.dispose()
      await this._hooks.dispose?.()
      this.parent?._children.delete(this.id)
      this._children.clear()
      this._members.clear()
      this._setState('disposed')
      this._listeners.clear()
    })
  }

  public addRuntime(host: RuntimeHost<any, any>): void {
    this._assertNotDisposed('addRuntime')
    this._members.set(host.id, host)
  }

  public removeRuntime(runtimeId: string): void {
    this._members.delete(String(runtimeId ?? '').trim())
  }

  public markStale(): void {
    if (!this._updateGateOpen)
      this._stale = true
  }

  public acceptsUpdates(): boolean {
    return this.state === 'active' && this._updateGateOpen
  }

  public getRuntime(path: string): RuntimeHost<any, any> | null {
    return this._hooks.resolveRuntime?.(path) ?? null
  }

  public getOutput(name: string): unknown {
    return this._hooks.resolveOutput?.(name)
  }

  public getChildren(): RuntimeScope[] {
    return [...this._children.values()]
  }

  public snapshot(): RuntimeScopeSnapshot {
    return {
      id: this.id,
      path: this.path,
      parentScopeId: this.parent?.id ?? null,
      ownerRuntimeId: this.ownerRuntimeId,
      boundaryId: this.boundaryId,
      state: this.state,
      generation: this._generation,
      stale: this._stale,
      updateGateOpen: this._updateGateOpen,
      childScopeIds: [...this._children.keys()],
      memberRuntimeIds: [...this._members.keys()],
      resources: this.resources.snapshot(),
      lastError: this._lastError,
    }
  }

  private async _resume(): Promise<void> {
    if (this.state === 'active') return
    this._assertNotDisposed('resume')
    if (this.state !== 'paused')
      throw new Error(`[RuntimeScope] Cannot resume "${this.path}" from ${this.state}.`)
    if (this.parent && this.parent.state !== 'active' && this.parent.state !== 'resuming')
      await this.parent.resume()
    this._setState('resuming')
    this._generation += 1
    this._abortController = new AbortController()
    try {
      await this.resources.resume()
      await this._hooks.resume?.()
      for (const host of this._members.values())
        await host.resume?.()
      for (const childId of this._activeChildrenBeforePause)
        await this._children.get(childId)?.resume()
      if (this._stale)
        await this._hooks.reconcile?.()
      this._stale = false
      this._updateGateOpen = true
      this._setState('active')
    }
    catch (error) {
      this._updateGateOpen = false
      this._setError(error)
      throw error
    }
  }

  private async _safeDeactivate(): Promise<void> {
    const errors: unknown[] = []
    for (const child of [...this._children.values()].reverse()) {
      try { await child.deactivate() }
      catch (error) { errors.push(error) }
    }
    for (const host of [...this._members.values()].reverse()) {
      try {
        if (this._hooks.destroyRuntime)
          await this._hooks.destroyRuntime(host.id)
        else {
          await host.stop?.()
          await host.unmount?.()
          host.destroy()
        }
      }
      catch (error) { errors.push(error) }
    }
    this._members.clear()
    try { await this._hooks.deactivate?.() }
    catch (error) { errors.push(error) }
    try { await this.resources.dispose() }
    catch (error) { errors.push(error) }
    if (errors.length)
      throw new AggregateError(errors, `[RuntimeScope] Failed to deactivate "${this.path}".`)
  }

  private _enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this._transition.then(operation, operation)
    this._transition = next.catch(() => {})
    return next
  }

  private _assertNotDisposed(operation: string): void {
    if (this.state === 'disposed')
      throw new Error(`[RuntimeScope] Cannot ${operation} disposed scope "${this.path}".`)
  }

  private _setError(error: unknown): void {
    this._lastError = error instanceof Error ? error.message : String(error)
    this._setState('error')
  }

  private _setState(state: RuntimeScopeState): void {
    if (this.state === state) return
    this.state = state
    for (const listener of this._listeners)
      listener()
  }
}

function required(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!normalized)
    throw new Error(`[RuntimeScope] ${field} is required.`)
  return normalized
}

async function waitForAbortable(value: Promise<void> | void, signal: AbortSignal): Promise<void> {
  if (signal.aborted)
    throw new DOMException('Runtime scope activation aborted.', 'AbortError')
  if (!value) return
  await new Promise<void>((resolve, reject) => {
    const abort = () => reject(new DOMException('Runtime scope activation aborted.', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    value.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
