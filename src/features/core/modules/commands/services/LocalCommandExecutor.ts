import type { EndgeCommand, EndgeCommandType } from '@/features/core/modules/commands/domain/commands.types'
import type { EndgeCommandExecutor, EndgeCommandHandler } from '@/features/core/modules/commands/types/command-executor.type'

/** Находит явно зарегистрированный обработчик и выполняет команду локально. */
export class LocalCommandExecutor implements EndgeCommandExecutor {
  private readonly _handlers = new Map<EndgeCommandType, EndgeCommandHandler>()

  public constructor(handlers: readonly EndgeCommandHandler[]) {
    for (const handler of handlers) {
      if (this._handlers.has(handler.type)) {
        throw new Error(`[Endge Commands] Duplicate command: ${handler.type}`)
      }
      this._handlers.set(handler.type, handler)
    }
  }

  /** Неизвестная команда завершается ошибкой; fallback на произвольный метод отсутствует. */
  public async execute(command: EndgeCommand): Promise<void> {
    const handler = this._handlers.get(command.type)
    if (!handler) {
      throw new Error(`[Endge Commands] Unknown command: ${command.type}`)
    }
    await handler.execute(command.payload)
  }
}
