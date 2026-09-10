import type { EndgeCommandHandler } from '@/features/core/modules/commands/types/command-executor.type'
import type { EndgeContextCommandTarget } from '@/features/core/modules/commands/types/context-command-target.type'
import { readCommandString } from '@/features/core/modules/commands/tools/command-payload'

/** Применяет запрос изменения окружения через существующий метод Context. */
export class SetEnvironmentCommand implements EndgeCommandHandler {
  public readonly type = 'context:set-environment' as const
  private readonly _context: Pick<EndgeContextCommandTarget, 'setCurrentEnvironment'>

  public constructor(context: Pick<EndgeContextCommandTarget, 'setCurrentEnvironment'>) {
    this._context = context
  }

  public execute(payload: unknown): void | Promise<void> {
    return this._context.setCurrentEnvironment(readCommandString(payload, 'environment'))
  }
}
