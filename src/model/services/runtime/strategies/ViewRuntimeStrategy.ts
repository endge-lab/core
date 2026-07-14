import { RView } from '@/domain/entities/reflect/RView'
import { ViewRuntimeHost } from '@/domain/entities/runtime/hosts/ViewRuntimeHost'
import type { RuntimeStrategy } from '@/domain/types/runtime/runtime-strategy.types'

export class ViewRuntimeStrategy implements RuntimeStrategy<RView> {
  public readonly id = 'runtime:view'
  public readonly entityType = 'view'

  public supports(model: unknown): model is RView {
    return model instanceof RView || (model as any)?.type === 'view'
  }

  public create(ctx: Parameters<RuntimeStrategy<RView>['create']>[0]) {
    return ViewRuntimeHost.createRuntime({
      id: ctx.id,
      model: ctx.model,
      meta: ctx.meta,
      parent: ctx.parent,
    })
  }
}
