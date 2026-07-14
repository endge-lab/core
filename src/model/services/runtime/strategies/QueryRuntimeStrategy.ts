import { RQuery } from '@/domain/entities/reflect/RQuery'
import { QueryRuntimeHost } from '@/domain/entities/runtime/hosts/QueryRuntimeHost'
import type { RuntimeStrategy } from '@/domain/types/runtime/runtime-strategy.types'

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
