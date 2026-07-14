import type {
  AnyRuntimeCommand,
  RuntimeCommand,
  RuntimeCommandContext,
  RuntimeCommandId,
  RuntimeCommandRegistrySnapshot,
} from '@/domain/types/runtime/command.types'

export class RuntimeCommandRegistry {
  private readonly _commands = new Map<RuntimeCommandId, AnyRuntimeCommand>()

  public register<TContext extends RuntimeCommandContext, TPayload = unknown>(
    command: RuntimeCommand<TContext, TPayload>,
  ): () => void {
    this.assertCommandId(command.id)

    this._commands.set(command.id, command as AnyRuntimeCommand)

    return () => {
      this.unregister(command.id)
    }
  }

  public registerMany(commands: AnyRuntimeCommand[]): void {
    for (const command of commands) {
      this.register(command)
    }
  }

  public unregister(id: RuntimeCommandId): void {
    this._commands.delete(id)
  }

  public clear(): void {
    this._commands.clear()
  }

  public has(id: RuntimeCommandId): boolean {
    return this._commands.has(id)
  }

  public get<TContext extends RuntimeCommandContext, TPayload = unknown>(
    id: RuntimeCommandId,
  ): RuntimeCommand<TContext, TPayload> | null {
    return (this._commands.get(id) as RuntimeCommand<TContext, TPayload> | undefined) ?? null
  }

  public list(input?: { surface?: string }): AnyRuntimeCommand[] {
    const commands = [...this._commands.values()]
    if (!input?.surface)
      return commands

    return commands.filter(command => command.surface == null || command.surface === input.surface)
  }

  public canExecute<TContext extends RuntimeCommandContext, TPayload = unknown>(
    id: RuntimeCommandId,
    context: TContext,
    payload?: TPayload,
  ): boolean {
    const command = this.get<TContext, TPayload>(id)
    if (!command)
      return false

    return command.canExecute ? command.canExecute(context, payload) : true
  }

  public async execute<TContext extends RuntimeCommandContext, TPayload = unknown>(
    id: RuntimeCommandId,
    context: TContext,
    payload?: TPayload,
  ): Promise<void> {
    const command = this.get<TContext, TPayload>(id)
    if (!command)
      throw new Error(`[RuntimeCommandRegistry] command is not registered: ${id}`)

    if (!this.canExecute(id, context, payload))
      return

    await command.execute(context, payload)
  }

  public snapshot(): RuntimeCommandRegistrySnapshot {
    return {
      commands: this.list().map(command => ({
        id: command.id,
        label: command.label,
        description: command.description,
        surface: command.surface,
      })),
    }
  }

  private assertCommandId(id: RuntimeCommandId): void {
    if (!String(id ?? '').trim())
      throw new Error('[RuntimeCommandRegistry] command id is required')
  }
}
