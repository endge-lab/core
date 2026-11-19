import type { ModuleArtifactLoader, ModuleContribution, ScopedModule } from './module-artifact'
import type { ModuleReference } from './module-reference'
import type { RuntimeScope } from '@/features/core/modules/runtime/RuntimeScope'
import { moduleReferenceKey } from './module-artifact'
import { isModuleReference } from './module-reference'

type Contributions = Map<string, Map<string, unknown>>

interface PreparedModule {
  reference: string
  instance: ScopedModule
  contributions: Contributions
  visualToken: string
  dispose: () => Promise<void>
}

interface Attachment {
  current: PreparedModule | null
  pending: Promise<void>
  disposed: boolean
}

export class RuntimeModules {
  private readonly _scopes = new WeakMap<RuntimeScope, Map<string, Attachment>>()
  private readonly _listeners = new Set<() => void>()
  private _loader: ModuleArtifactLoader | undefined
  private _sequence = 0

  public setup(loader: ModuleArtifactLoader | undefined): void {
    this._loader = loader
  }

  public subscribe(listener: () => void): () => void {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  public resolve<T>(scope: RuntimeScope | null, channel: string, key: string): ModuleContribution<T> | undefined {
    for (const module of this._visible(scope)) {
      const value = module.contributions.get(channel)?.get(key)
      if (value !== undefined) {
        return { value: value as T, visualToken: module.visualToken }
      }
    }
    return undefined
  }

  public list<T>(scope: RuntimeScope | null, channel: string): ReadonlyMap<string, ModuleContribution<T>> {
    const entries = new Map<string, ModuleContribution<T>>()
    for (const module of this._visible(scope)) {
      for (const [name, value] of module.contributions.get(channel) ?? []) {
        if (!entries.has(name)) {
          entries.set(name, { value: value as T, visualToken: module.visualToken })
        }
      }
    }
    return entries
  }

  private* _visible(scope: RuntimeScope | null): Generator<PreparedModule> {
    const attachments = new Set<string>()
    for (let current = scope; current; current = current.parent) {
      const scoped = this._scopes.get(current)
      if (scoped) {
        for (const [key, attachment] of [...scoped].reverse()) {
          if (attachment.current && !attachments.has(key)) {
            attachments.add(key)
            yield attachment.current
          }
        }
      }
    }
  }

  public attach(scope: RuntimeScope, attachment: string, reference: ModuleReference): Promise<void> {
    const state = this._getOrCreate(scope, attachment)
    return this._replace(scope, attachment, state, reference)
  }

  public replace(scope: RuntimeScope, attachment: string, reference: ModuleReference): Promise<void> {
    const state = this._scopes.get(scope)?.get(attachment)
    if (!state?.current) {
      throw new Error(`Module attachment "${attachment}" does not exist in scope "${scope.path}".`)
    }
    return this._replace(scope, attachment, state, reference)
  }

  private _getOrCreate(scope: RuntimeScope, attachment: string): Attachment {
    let scoped = this._scopes.get(scope)
    if (!scoped) {
      scoped = new Map()
      this._scopes.set(scope, scoped)
    }
    const previous = scoped.get(attachment)
    if (previous) {
      return previous
    }
    const state: Attachment = { current: null, pending: Promise.resolve(), disposed: false }
    scope.resources.add({
      id: `${scope.id}:module:${attachment}`,
      kind: 'module',
      pause: () => state.current?.instance.pause?.(),
      resume: () => state.current?.instance.resume?.(),
      dispose: async () => {
        state.disposed = true
        const old = state.current
        state.current = null
        scoped.delete(attachment)
        this._notify()
        await old?.dispose()
      },
    })
    scoped.set(attachment, state)
    return state
  }

  private _replace(scope: RuntimeScope, attachment: string, state: Attachment, reference: ModuleReference): Promise<void> {
    const signal = scope.signal
    const nextReference = { identity: reference.identity, version: reference.version }
    const run = async () => {
      if (!signal || signal.aborted || state.disposed) {
        throw new DOMException('Module scope is inactive.', 'AbortError')
      }
      if (state.current?.reference === moduleReferenceKey(nextReference)) {
        return
      }
      const next = await this._prepare(scope, attachment, nextReference, signal)
      if (signal.aborted || state.disposed) {
        await next.dispose()
        throw new DOMException('Module scope was deactivated.', 'AbortError')
      }
      const old = state.current
      state.current = next
      this._notify()
      // Allow observers to apply the new registrations before resetting the previous instance.
      await Promise.resolve()
      await old?.dispose()
    }
    const transition = state.pending.then(run)
    state.pending = transition.catch(() => {})
    return transition
  }

  private async _prepare(scope: RuntimeScope, attachment: string, reference: ModuleReference, signal: AbortSignal): Promise<PreparedModule> {
    if (!this._loader || !isModuleReference(reference.identity, reference.version)) {
      throw new Error(`Cannot load module "${moduleReferenceKey(reference)}". Check the host loader and exact version.`)
    }
    const artifact = await this._loader(Object.freeze(reference), signal)
    signal.throwIfAborted()
    const instance = artifact.create()
    const contributions: Contributions = new Map()
    const controller = new AbortController()
    const abort = () => controller.abort(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    const visualToken = `endge-module-${++this._sequence}`
    let releaseStyle: (() => void) | undefined
    let committed = false
    const dispose = async () => {
      committed = false
      controller.abort()
      try {
        releaseStyle?.()
      }
      finally {
        try {
          await instance.reset()
        }
        finally {
          contributions.clear()
        }
      }
    }
    const context = {
      scopeId: scope.id,
      attachment,
      reference,
      signal: controller.signal,
      register: (channel: string, key: string, value: unknown) => {
        controller.signal.throwIfAborted()
        let entries = contributions.get(channel)
        if (!entries) {
          entries = new Map()
          contributions.set(channel, entries)
        }
        if (!channel || !key || value === undefined || entries.has(key)) {
          throw new Error(`Invalid or duplicate module contribution "${channel}:${key}".`)
        }
        entries.set(key, value)
        if (committed) {
          this._notify()
        }
        const registered = entries
        let released = false
        return () => {
          if (released) {
            return
          }
          released = true
          if (registered.delete(key) && committed) {
            this._notify()
          }
        }
      },
    }
    try {
      for (const phase of ['setup', 'load', 'build', 'start'] as const) {
        controller.signal.throwIfAborted()
        await instance[phase](context)
      }
      controller.signal.throwIfAborted()
      releaseStyle = artifact.installStyle?.(visualToken)
      committed = true
      return { reference: moduleReferenceKey(reference), instance, contributions, visualToken, dispose }
    }
    catch (error) {
      try {
        await dispose()
      }
      catch (cleanup) {
        throw new AggregateError([error, cleanup], `Module "${moduleReferenceKey(reference)}" failed to initialize and reset.`)
      }
      throw error
    }
    finally {
      signal.removeEventListener('abort', abort)
    }
  }

  private _notify(): void {
    for (const listener of this._listeners) {
      try {
        listener()
      }
      catch (error) {
        console.error('[RuntimeModules] Observer failed.', error)
      }
    }
  }
}
