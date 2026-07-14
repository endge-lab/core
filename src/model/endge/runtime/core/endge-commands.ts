import type {
  AnyRuntimeCommand,
  RuntimeCommand,
  RuntimeCommandContext,
  RuntimeCommandId,
  RuntimeCommandRegistrySnapshot,
} from '@/domain/types/runtime/command.types'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { RuntimeCommandRegistry } from '@/domain/entities/runtime/RuntimeCommandRegistry'
import { createTableRuntimeCommands } from '@/model/services/runtime/table-commands'

export class EndgeCommands extends EndgeModule {
  private readonly _registry = new RuntimeCommandRegistry()

  public constructor() {
    super()
    this.reset()
  }

  public override reset(): void {
    this._registry.clear()
    this._registry.registerMany(createTableRuntimeCommands())
    this.notify()
  }

  public register<TContext extends RuntimeCommandContext, TPayload = unknown>(
    command: RuntimeCommand<TContext, TPayload>,
  ): () => void {
    const unregister = this._registry.register(command)
    this.notify()
    return () => {
      unregister()
      this.notify()
    }
  }

  public registerMany(commands: AnyRuntimeCommand[]): void {
    this._registry.registerMany(commands)
    this.notify()
  }

  public unregister(id: RuntimeCommandId): void {
    this._registry.unregister(id)
    this.notify()
  }

  public has(id: RuntimeCommandId): boolean {
    return this._registry.has(id)
  }

  public get<TContext extends RuntimeCommandContext, TPayload = unknown>(
    id: RuntimeCommandId,
  ): RuntimeCommand<TContext, TPayload> | null {
    return this._registry.get<TContext, TPayload>(id)
  }

  public list(input?: { surface?: string }): AnyRuntimeCommand[] {
    return this._registry.list(input)
  }

  public canExecute<TContext extends RuntimeCommandContext, TPayload = unknown>(
    id: RuntimeCommandId,
    context: TContext,
    payload?: TPayload,
  ): boolean {
    return this._registry.canExecute(id, context, payload)
  }

  public execute<TContext extends RuntimeCommandContext, TPayload = unknown>(
    id: RuntimeCommandId,
    context: TContext,
    payload?: TPayload,
  ): Promise<void> {
    return this._registry.execute(id, context, payload)
  }

  public override serialize(): RuntimeCommandRegistrySnapshot {
    return this._registry.snapshot()
  }
}
