import type {
  AnyRuntimeAction,
  RuntimeAction,
  RuntimeActionContext,
  RuntimeActionId,
  RuntimeActionRegistrySnapshot,
} from '@/domain/types/runtime/action.types'

import { Subscribable } from '@endge/utils'
import { RuntimeActionRegistry } from '@/domain/entities/runtime/RuntimeActionRegistry'
import { createTableRuntimeActions } from '@/model/services/runtime/table-actions'

/** Single module for registration and execution of callable runtime Actions. */
export class EndgeActions extends Subscribable {
  private readonly _registry = new RuntimeActionRegistry()

  public constructor() {
    super()
    this.reset()
  }

  public reset(): void {
    this._registry.clear()
    this._registry.registerMany(createTableRuntimeActions())
    this.notify()
  }

  public register<TContext extends RuntimeActionContext, TPayload = unknown, TResult = void>(
    action: RuntimeAction<TContext, TPayload, TResult>,
  ): () => void {
    const unregister = this._registry.register(action)
    this.notify()
    return () => {
      unregister()
      this.notify()
    }
  }

  public registerMany(actions: AnyRuntimeAction[]): void {
    this._registry.registerMany(actions)
    this.notify()
  }

  public unregister(id: RuntimeActionId): void {
    this._registry.unregister(id)
    this.notify()
  }

  public has(id: RuntimeActionId): boolean {
    return this._registry.has(id)
  }

  public get<TContext extends RuntimeActionContext, TPayload = unknown, TResult = void>(
    id: RuntimeActionId,
  ): RuntimeAction<TContext, TPayload, TResult> | null {
    return this._registry.get<TContext, TPayload, TResult>(id)
  }

  public list(input?: { surface?: string }): AnyRuntimeAction[] {
    return this._registry.list(input)
  }

  public canExecute<TContext extends RuntimeActionContext, TPayload = unknown>(
    id: RuntimeActionId,
    context: TContext,
    payload?: TPayload,
  ): boolean {
    return this._registry.canExecute(id, context, payload)
  }

  public execute<TContext extends RuntimeActionContext, TPayload = unknown, TResult = void>(
    id: RuntimeActionId,
    context: TContext,
    payload?: TPayload,
  ): Promise<TResult | undefined> {
    return this._registry.execute<TContext, TPayload, TResult>(id, context, payload)
  }

  public serialize(): RuntimeActionRegistrySnapshot {
    return this._registry.snapshot()
  }
}
