import type { EndgeCommandHandler } from '@/features/core/modules/commands/types/command-executor.type'
import type { EndgeContextCommandTarget } from '@/features/core/modules/commands/types/context-command-target.type'
import { readCommandString } from '@/features/core/modules/commands/tools/command-payload'

/** Применяет запрос изменения пользователя через существующий метод Context. */
export class SetUserCommand implements EndgeCommandHandler {
  public readonly type = 'context:set-user' as const
  private readonly _context: Pick<EndgeContextCommandTarget, 'setCurrentUser'>

  public constructor(context: Pick<EndgeContextCommandTarget, 'setCurrentUser'>) {
    this._context = context
  }

  public execute(payload: unknown): void | Promise<void> {
    return this._context.setCurrentUser(readCommandString(payload, 'user'))
  }
}
