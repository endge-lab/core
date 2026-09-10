import type { EndgeCommandHandler } from '@/features/core/modules/commands/types/command-executor.type'
import type { EndgeContextCommandTarget } from '@/features/core/modules/commands/types/context-command-target.type'
import { readCommandNullableString } from '@/features/core/modules/commands/tools/command-payload'

/** Применяет запрос изменения темы через существующий метод Context. */
export class SetThemeCommand implements EndgeCommandHandler {
  public readonly type = 'context:set-theme' as const
  private readonly _context: Pick<EndgeContextCommandTarget, 'setCurrentTheme'>

  public constructor(context: Pick<EndgeContextCommandTarget, 'setCurrentTheme'>) {
    this._context = context
  }

  public execute(payload: unknown): void | Promise<void> {
    return this._context.setCurrentTheme(readCommandNullableString(payload, 'theme'))
  }
}
