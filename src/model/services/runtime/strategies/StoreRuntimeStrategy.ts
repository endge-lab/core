import { RStore } from '@/domain/entities/reflect/RStore'
import { StoreRuntimeHost } from '@/domain/entities/runtime/hosts/StoreRuntimeHost'
import type { RuntimeStrategy } from '@/model/services/runtime/RuntimeStrategy'

export class StoreRuntimeStrategy implements RuntimeStrategy<RStore, StoreRuntimeHost> {
  public readonly id = 'runtime:store'
  public readonly entityType = 'store' as const

  public supports(model: unknown): model is RStore {
    return model instanceof RStore
      || (model as any)?.type === 'store'
  }

  public create(ctx: Parameters<RuntimeStrategy<RStore, StoreRuntimeHost>['create']>[0]) {
    return StoreRuntimeHost.createRuntime({
      id: ctx.id,
      model: ctx.model,
      meta: ctx.meta,
      parent: ctx.parent,
      artifacts: ctx.artifacts,
    })
  }
}
