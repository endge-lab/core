import type { EndgeCommand } from '@/features/core/modules/commands/domain/commands.types'
import type { EndgeCommandExecutor, EndgeRemoteCommandTransport } from '@/features/core/modules/commands/types/command-executor.type'

/** Передаёт любую поддерживаемую команду удалённому клиенту без вызова локальных обработчиков. */
export class RemoteCommandExecutor implements EndgeCommandExecutor {
  private readonly _transport: EndgeRemoteCommandTransport | undefined

  public constructor(transport?: EndgeRemoteCommandTransport) {
    this._transport = transport
  }

  /** Отсутствие транспорта и отказ клиента не заменяются локальным выполнением. */
  public async execute(command: EndgeCommand): Promise<void> {
    if (!this._transport) {
      throw new Error('[Endge Commands] Remote command transport is not configured')
    }
    await this._transport.send(command)
  }
}
