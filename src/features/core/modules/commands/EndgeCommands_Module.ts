import type { EndgeBootContext } from '@/features/core/kernel/types/bootstrap.types'
import type { EndgeCommand } from '@/features/core/modules/commands/domain/commands.types'
import type { EndgeCommandExecutor } from '@/features/core/modules/commands/types/command-executor.type'
import { RemoteCommandExecutor } from '@/features/core/modules/commands/services/RemoteCommandExecutor'
import { EndgeModule } from '@/features/federation/EndgeModule'

/** Выбирает способ выполнения команд по boot mode, не владея изменяемым контекстом. */
export class EndgeCommands_Module extends EndgeModule<EndgeBootContext> {
  private readonly _localExecutor: EndgeCommandExecutor
  private _remote = false
  private _executor: EndgeCommandExecutor | null = null

  public constructor(localExecutor: EndgeCommandExecutor) {
    super()
    this._localExecutor = localExecutor
  }

  /** Клиент выполняет команды локально, дебагер передаёт их через предоставленный host транспорт. */
  public override setup(ctx: EndgeBootContext): void {
    this._remote = ctx.mode === 'debugger'
    this._executor = this._remote
      ? new RemoteCommandExecutor(ctx.commands?.remote)
      : ctx.commands?.local ?? this._localExecutor
  }

  /** Делегирует команду; состояние и публикация событий остаются у владельца операции. */
  public async execute(command: EndgeCommand): Promise<void> {
    if (!this._executor) {
      throw new Error('[Endge Commands] Command execution requires boot setup')
    }
    const executor = !this._remote && command.type.startsWith('runtime:') ? this._localExecutor : this._executor
    return executor.execute(command)
  }

  /** Отзывает выбранного исполнителя и ссылку на транспорт перед следующим boot. */
  public override reset(): void {
    this._executor = null
  }
}
