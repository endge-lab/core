import type { EndgeCommandHandler } from '@/features/core/modules/commands/types/command-executor.type'
import type { EndgeContextCommandTarget } from '@/features/core/modules/commands/types/context-command-target.type'
import { readCommandString } from '@/features/core/modules/commands/tools/command-payload'

/** Применяет запрос изменения проекта через существующий метод Context. */
export class SetProjectCommand implements EndgeCommandHandler {
  public readonly type = 'context:set-project' as const
  private readonly _context: Pick<EndgeContextCommandTarget, 'setCurrentProject'>

  public constructor(context: Pick<EndgeContextCommandTarget, 'setCurrentProject'>) {
    this._context = context
  }

  public execute(payload: unknown): void | Promise<void> {
    return this._context.setCurrentProject(readCommandString(payload, 'project'))
  }
}
