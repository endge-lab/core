import type { EndgeCommand, EndgeCommandType } from '@/features/core/modules/commands/domain/commands.types'

/** Исполнитель определяет способ выполнения команды, сохраняя единый API для вызывающего кода. */
export interface EndgeCommandExecutor {
  execute: (command: EndgeCommand) => Promise<void>
}

/** Отправляет команду выбранному удалённому клиенту и возвращает результат её выполнения. */
export interface EndgeRemoteCommandTransport {
  send: (command: EndgeCommand) => Promise<void>
}

/** Host передаёт транспорт текущего сеанса; режим исполнения определяется общим boot mode. */
export interface EndgeCommandsBootOptions {
  local?: EndgeCommandExecutor
  remote?: EndgeRemoteCommandTransport
}

/** Обработчик одной команды проверяет payload до обращения к владельцу операции. */
export interface EndgeCommandHandler {
  readonly type: EndgeCommandType
  execute: (payload: unknown) => void | Promise<void>
}
