import { RAction } from '@/domain/entities/reflect/RAction'
import { ActionRuntimeHost } from '@/domain/entities/runtime/hosts/ActionRuntimeHost'
import type { RuntimeStrategy } from '@/domain/types/runtime/runtime-strategy.types'

export class ActionRuntimeStrategy implements RuntimeStrategy<RAction> {
  public readonly id = 'runtime:action'
  public readonly entityType = 'action'

  public supports(model: unknown): model is RAction {
    return model instanceof RAction || Array.isArray((model as any)?.definition?.nodes)
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
