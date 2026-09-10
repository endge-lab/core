import type { EndgeCommandHandler } from '@/features/core/modules/commands/types/command-executor.type'
import type { EndgeContextCommandTarget } from '@/features/core/modules/commands/types/context-command-target.type'
import { readCommandString } from '@/features/core/modules/commands/tools/command-payload'

/** Применяет запрос изменения tenant через существующий метод Context. */
export class SetTenantCommand implements EndgeCommandHandler {
  public readonly type = 'context:set-tenant' as const
  private readonly _context: Pick<EndgeContextCommandTarget, 'setCurrentTenant'>

  public constructor(context: Pick<EndgeContextCommandTarget, 'setCurrentTenant'>) {
    this._context = context
  }

  public execute(payload: unknown): void | Promise<void> {
    return this._context.setCurrentTenant(readCommandString(payload, 'tenant'))
  }
}
