import type { RuntimeHost } from '@/features/core/modules/runtime/domain/runtime-host.types'

import type { RuntimeScope } from '@/features/core/modules/runtime/RuntimeScope'
import { EndgeModule } from '@/features/federation/EndgeModule'

/** Индексирует runtime scopes и membership RuntimeHost. */
export class EndgeRuntimeScopes_Module extends EndgeModule {
  private readonly _scopes = new Map<string, RuntimeScope>()
  private readonly _scopeByRuntime = new Map<string, string>()
  private readonly _scopeDisposers = new Map<string, () => void>()
  private _transactionDepth = 0
  private _notificationPending = false

  /**
   * ----------------------------------------
   * PUBLIC
   * ----------------------------------------
   */

  public register(scope: RuntimeScope): RuntimeScope {
    if (this._scopes.has(scope.id)) {
      throw new Error(`[EndgeRuntimeScopes_Module] Scope "${scope.id}" is already registered.`)
    }
    this._scopes.set(scope.id, scope)
    this._scopeDisposers.set(scope.id, scope.subscribe(() => this._changed()))
    this._changed()
    return scope
  }

  public transaction<T>(operation: () => T): T {
    this._transactionDepth += 1
    const finish = () => {
      this._transactionDepth -= 1
      if (!this._transactionDepth && this._notificationPending) {
        this._notificationPending = false
        this.notify()
      }
    }
    try {
      const result = operation()
      if (result && typeof (result as any).then === 'function') {
        return (result as any).finally(finish)
      }
      finish()
      return result
    }
    catch (error) {
      finish()
      throw error
    }
  }

  public get(id: string): RuntimeScope | null {
    return this._scopes.get(String(id ?? '').trim()) ?? null
  }

  public getAll(): RuntimeScope[] {
    return [...this._scopes.values()]
  }

  public snapshot() {
    return this.getAll().map(scope => scope.snapshot())
  }

  public attachRuntime(scopeId: string, host: RuntimeHost<any, any>): void {
    const scope = this.get(scopeId)
    if (!scope) {
      throw new Error(`[EndgeRuntimeScopes_Module] Scope "${scopeId}" is missing.`)
    }
    const previous = this._scopeByRuntime.get(host.id)
    if (previous && previous !== scope.id) {
      throw new Error(`[EndgeRuntimeScopes_Module] Runtime "${host.id}" already belongs to scope "${previous}".`)
    }
    scope.addRuntime(host)
    this._scopeByRuntime.set(host.id, scope.id)
  }

  public detachRuntime(runtimeId: string): void {
    const id = String(runtimeId ?? '').trim()
    const scopeId = this._scopeByRuntime.get(id)
    if (scopeId) {
      this.get(scopeId)?.removeRuntime(id)
    }
    this._scopeByRuntime.delete(id)
  }

  public getByRuntime(runtimeId: string): RuntimeScope | null {
    const scopeId = this._scopeByRuntime.get(String(runtimeId ?? '').trim())
    return scopeId ? this.get(scopeId) : null
  }

  public async remove(id: string): Promise<void> {
    const scope = this.get(id)
    if (!scope) {
      return
    }
    await scope.dispose()
    for (const [runtimeId, scopeId] of this._scopeByRuntime) {
      if (scopeId === scope.id) {
        this._scopeByRuntime.delete(runtimeId)
      }
    }
    this._scopes.delete(scope.id)
    this._scopeDisposers.get(scope.id)?.()
    this._scopeDisposers.delete(scope.id)
    this._changed()
  }

  public override async reset(): Promise<void> {
    const roots = this.getAll().filter(scope => !scope.parent)
    this._scopes.clear()
    this._scopeByRuntime.clear()
    for (const dispose of this._scopeDisposers.values()) {
      dispose()
    }
    this._scopeDisposers.clear()
    this._changed()
    for (const scope of roots.reverse()) {
      await scope.dispose()
    }
  }

  /**
   * ----------------------------------------
   * PRIVATE
   * ----------------------------------------
   */

  private _changed(): void {
    if (this._transactionDepth) {
      this._notificationPending = true
    }
    else { this.notify() }
  }
}
