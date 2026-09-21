import type { EndgeCommandHandler } from '@/features/core/modules/commands/types/command-executor.type'
import type { EndgeContextCommandTarget } from '@/features/core/modules/commands/types/context-command-target.type'
import { readCommandString } from '@/features/core/modules/commands/tools/command-payload'

/** Применяет запрос выбора документа произвольного динамического фасета. */
export class SetFacetCommand implements EndgeCommandHandler {
  public readonly type = 'context:set-facet' as const
  private readonly _context: Pick<EndgeContextCommandTarget, 'setFacetSelection'>

  public constructor(context: Pick<EndgeContextCommandTarget, 'setFacetSelection'>) {
    this._context = context
  }

  public execute(payload: unknown): void | Promise<void> {
    return this._context.setFacetSelection(
      readCommandString(payload, 'facet'),
      readCommandString(payload, 'document'),
    )
  }
}
