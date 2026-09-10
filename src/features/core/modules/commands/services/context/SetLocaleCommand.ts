import type { EndgeCommandHandler } from '@/features/core/modules/commands/types/command-executor.type'
import type { EndgeContextCommandTarget } from '@/features/core/modules/commands/types/context-command-target.type'
import { readCommandNullableString } from '@/features/core/modules/commands/tools/command-payload'

/** Применяет запрос изменения языка через существующий метод Context. */
export class SetLocaleCommand implements EndgeCommandHandler {
  public readonly type = 'context:set-locale' as const
  private readonly _context: Pick<EndgeContextCommandTarget, 'setCurrentLocale'>

  public constructor(context: Pick<EndgeContextCommandTarget, 'setCurrentLocale'>) {
    this._context = context
  }

  public execute(payload: unknown): void | Promise<void> {
    return this._context.setCurrentLocale(readCommandNullableString(payload, 'locale'))
  }
}
