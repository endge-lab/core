import type { RuntimeStrategy } from '@/features/core/modules/runtime/domain/runtime-strategy.types'
import { RAction } from '@/features/core/modules/domain/entities/RAction'
import { ActionRuntimeHost } from '@/features/core/modules/runtime/hosts/ActionRuntimeHost'

export class ActionRuntimeStrategy implements RuntimeStrategy<RAction> {
  public readonly id = 'runtime:action'
  public readonly entityType = 'action'

  public supports(model: unknown): model is RAction {
    return model instanceof RAction || typeof (model as any)?.source === 'string'
  }

  public create(ctx: Parameters<RuntimeStrategy<RAction>['create']>[0]) {
    return ActionRuntimeHost.createRuntime({
      id: ctx.id,
      model: ctx.model,
      meta: ctx.meta,
      parent: ctx.parent,
    })
  }
}
