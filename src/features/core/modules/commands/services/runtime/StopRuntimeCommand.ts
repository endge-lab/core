import type { EndgeCommandHandler } from '@/features/core/modules/commands/types/command-executor.type'
import type { EndgeRuntimeCommandTarget } from '@/features/core/modules/commands/types/runtime-command-target.type'
import { readRuntimeControlTarget } from '@/features/core/modules/runtime/tools/runtime-inspection'

/** Делегирует stop существующему владельцу runtime lifecycle. */
export class StopRuntimeCommand implements EndgeCommandHandler {
  public readonly type = 'runtime:stop' as const
  public constructor(private readonly _runtime: EndgeRuntimeCommandTarget) {}
  public execute(payload: unknown): Promise<void> {
    return this._runtime.control('stop', readRuntimeControlTarget(payload))
  }
}
