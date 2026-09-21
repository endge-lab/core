import type { EndgeCommandHandler } from '@/features/core/modules/commands/types/command-executor.type'
import type { EndgeContextCommandTarget } from '@/features/core/modules/commands/types/context-command-target.type'
import { readCommandNullableString } from '@/features/core/modules/commands/tools/command-payload'

/** Применяет запрос изменения рабочего пространства через существующий метод Context. */
export class SetWorkspaceCommand implements EndgeCommandHandler {
  public readonly type = 'context:set-workspace' as const
  private readonly _context: Pick<EndgeContextCommandTarget, 'setCurrentWorkspace'>

  public constructor(context: Pick<EndgeContextCommandTarget, 'setCurrentWorkspace'>) {
    this._context = context
  }

  public execute(payload: unknown): void | Promise<void> {
    return this._context.setCurrentWorkspace(readCommandNullableString(payload, 'workspace'))
  }
}
