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

/** Модуль регистрации и выполнения runtime-команд. */
export class EndgeCommands extends EndgeModule {
  private readonly _registry = new RuntimeCommandRegistry()

  /** Создаёт registry и регистрирует встроенные команды. */
  public constructor() {
    super()
    this.reset()
  }

  /** Сбрасывает registry к набору встроенных команд. */
  public override reset(): void {
    this._registry.clear()
    this._registry.registerMany(createTableRuntimeCommands())
    this.notify()
  }

  /** Регистрирует одну runtime-команду и возвращает функцию удаления. */
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

  /** Регистрирует несколько runtime-команд. */
  public registerMany(commands: AnyRuntimeCommand[]): void {
    this._registry.registerMany(commands)
    this.notify()
  }

  /** Удаляет runtime-команду по id. */
  public unregister(id: RuntimeCommandId): void {
    this._registry.unregister(id)
    this.notify()
  }

  /** Проверяет наличие runtime-команды. */
  public has(id: RuntimeCommandId): boolean {
    return this._registry.has(id)
  }

  /** Возвращает runtime-команду по id. */
  public get<TContext extends RuntimeCommandContext, TPayload = unknown>(
    id: RuntimeCommandId,
  ): RuntimeCommand<TContext, TPayload> | null {
    return this._registry.get<TContext, TPayload>(id)
  }

  /** Возвращает команды с необязательной фильтрацией по surface. */
  public list(input?: { surface?: string }): AnyRuntimeCommand[] {
    return this._registry.list(input)
  }

  /** Проверяет возможность выполнить команду в заданном контексте. */
  public canExecute<TContext extends RuntimeCommandContext, TPayload = unknown>(
    id: RuntimeCommandId,
    context: TContext,
    payload?: TPayload,
  ): boolean {
    return this._registry.canExecute(id, context, payload)
  }

  /** Выполняет runtime-команду. */
  public execute<TContext extends RuntimeCommandContext, TPayload = unknown>(
    id: RuntimeCommandId,
    context: TContext,
    payload?: TPayload,
  ): Promise<void> {
    return this._registry.execute(id, context, payload)
  }

  /** Сериализует публичный snapshot registry. */
  public override serialize(): RuntimeCommandRegistrySnapshot {
    return this._registry.snapshot()
  }
}
