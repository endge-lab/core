import { RFilter } from '@/domain/entities/reflect/RFilter'
import { FilterRuntimeHost } from '@/domain/entities/runtime/hosts/FilterRuntimeHost'
import type { RuntimeStrategy } from '@/model/services/runtime/RuntimeStrategy'

export class FilterRuntimeStrategy implements RuntimeStrategy<RFilter, FilterRuntimeHost> {
  public readonly id = 'runtime:filter'
  public readonly entityType = 'filter' as const

  public supports(model: unknown): model is RFilter {
    return model instanceof RFilter
  }

  public create(ctx: Parameters<RuntimeStrategy<RFilter, FilterRuntimeHost>['create']>[0]) {
    return FilterRuntimeHost.createRuntime({
      id: ctx.id,
      model: ctx.model,
      meta: ctx.meta,
      parent: ctx.parent,
      artifacts: ctx.artifacts,
    })
  }

  public attach(ctx: Parameters<NonNullable<RuntimeStrategy<RFilter, FilterRuntimeHost>['attach']>>[0]): void {
    ctx.host.hydratePersistence()
  }
}
