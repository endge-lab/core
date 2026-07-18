import type {
  AnyRuntimeAction,
  RuntimeAction,
  RuntimeActionContext,
  RuntimeActionId,
  RuntimeActionRegistrySnapshot,
} from '@/domain/types/runtime/action.types'

/** Registry of callable runtime Action providers. */
export class RuntimeActionRegistry {
  private readonly _actions = new Map<RuntimeActionId, AnyRuntimeAction>()

  public register<TContext extends RuntimeActionContext, TPayload = unknown, TResult = void>(
    action: RuntimeAction<TContext, TPayload, TResult>,
  ): () => void {
    this._assertActionId(action.id)
    this._actions.set(action.id, action as AnyRuntimeAction)

    return () => this.unregister(action.id)
  }

  public registerMany(actions: AnyRuntimeAction[]): void {
    for (const action of actions) this.register(action)
  }

  public unregister(id: RuntimeActionId): void {
    this._actions.delete(id)
  }

  public clear(): void {
    this._actions.clear()
  }

  public has(id: RuntimeActionId): boolean {
    return this._actions.has(id)
  }

  public get<TContext extends RuntimeActionContext, TPayload = unknown, TResult = void>(
    id: RuntimeActionId,
  ): RuntimeAction<TContext, TPayload, TResult> | null {
    return (this._actions.get(id) as RuntimeAction<TContext, TPayload, TResult> | undefined) ?? null
  }

  public list(input?: { surface?: string }): AnyRuntimeAction[] {
    const actions = [...this._actions.values()]
    return input?.surface
      ? actions.filter(action => action.surface == null || action.surface === input.surface)
      : actions
  }

  public canExecute<TContext extends RuntimeActionContext, TPayload = unknown>(
    id: RuntimeActionId,
    context: TContext,
    payload?: TPayload,
  ): boolean {
    const action = this.get<TContext, TPayload>(id)
    return action ? (action.canExecute?.(context, payload) ?? true) : false
  }

  public async execute<TContext extends RuntimeActionContext, TPayload = unknown, TResult = void>(
    id: RuntimeActionId,
    context: TContext,
    payload?: TPayload,
  ): Promise<TResult | undefined> {
    const action = this.get<TContext, TPayload, TResult>(id)
    if (!action)
      throw new Error(`[RuntimeActionRegistry] action is not registered: ${id}`)
    if (!this.canExecute(id, context, payload))
      return undefined
    return await action.execute(context, payload)
  }

  public snapshot(): RuntimeActionRegistrySnapshot {
    return {
      actions: this.list().map(action => ({
        id: action.id,
        label: action.label,
        description: action.description,
        surface: action.surface,
      })),
    }
  }

  private _assertActionId(id: RuntimeActionId): void {
    if (!String(id ?? '').trim())
      throw new Error('[RuntimeActionRegistry] action id is required')
  }
}
