import type { RuntimeStrategy } from '@/features/core/modules/runtime/domain/runtime-strategy.types'
import { RQuery } from '@/features/core/modules/domain/entities/RQuery'
import { QueryRuntimeHost } from '@/features/core/modules/runtime/hosts/QueryRuntimeHost'

export class QueryRuntimeStrategy implements RuntimeStrategy<RQuery, QueryRuntimeHost> {
  public readonly id = 'runtime:query'
  public readonly entityType = 'query'

  public supports(model: unknown): model is RQuery {
    return model instanceof RQuery
  }

  public create(ctx: Parameters<RuntimeStrategy<RQuery>['create']>[0]) {
    return QueryRuntimeHost.createRuntime({
      id: ctx.id,
      model: ctx.model,
      meta: ctx.meta,
      parent: ctx.parent,
      artifacts: ctx.artifacts,
    })
  }
}
