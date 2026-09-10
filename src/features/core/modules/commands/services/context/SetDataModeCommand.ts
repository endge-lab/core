import type { EndgeCommandHandler } from '@/features/core/modules/commands/types/command-executor.type'
import type { EndgeContextCommandTarget } from '@/features/core/modules/commands/types/context-command-target.type'
import { readCommandNullableString } from '@/features/core/modules/commands/tools/command-payload'

/** Применяет запрос изменения режима данных через существующий метод Context. */
export class SetDataModeCommand implements EndgeCommandHandler {
  public readonly type = 'context:set-data-mode' as const
  private readonly _context: Pick<EndgeContextCommandTarget, 'setDataMode' | 'clearDataModeOverride'>

  public constructor(context: Pick<EndgeContextCommandTarget, 'setDataMode' | 'clearDataModeOverride'>) {
    this._context = context
  }

  public execute(payload: unknown): void | Promise<void> {
    const dataMode = readCommandNullableString(payload, 'dataMode')
    if (dataMode === null) {
      return this._context.clearDataModeOverride()
    }
    if (dataMode !== 'live' && dataMode !== 'mock') {
      throw new Error('[Endge Commands] "dataMode" must be "live" or "mock"')
    }
    return this._context.setDataMode(dataMode)
  }
}
