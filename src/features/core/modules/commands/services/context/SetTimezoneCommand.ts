import type { EndgeCommandHandler } from '@/features/core/modules/commands/types/command-executor.type'
import type { EndgeContextCommandTarget } from '@/features/core/modules/commands/types/context-command-target.type'
import { readCommandNullableString } from '@/features/core/modules/commands/tools/command-payload'

/** Применяет запрос изменения часового пояса через существующий метод Context. */
export class SetTimezoneCommand implements EndgeCommandHandler {
  public readonly type = 'context:set-timezone' as const
  private readonly _context: Pick<EndgeContextCommandTarget, 'setCurrentTimezone'>

  public constructor(context: Pick<EndgeContextCommandTarget, 'setCurrentTimezone'>) {
    this._context = context
  }

  public execute(payload: unknown): void | Promise<void> {
    return this._context.setCurrentTimezone(readCommandNullableString(payload, 'timezone'))
  }
}
