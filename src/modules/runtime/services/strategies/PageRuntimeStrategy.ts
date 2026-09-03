import type { RuntimeStrategy } from '@/modules/runtime/domain/runtime-strategy.types'
import { RPage } from '@/modules/domain/entities/RPage'
import { PageRuntimeHost } from '@/modules/runtime/hosts/PageRuntimeHost'

export class PageRuntimeStrategy implements RuntimeStrategy<RPage> {
  public readonly id = 'runtime:page'
  public readonly entityType = 'page'

  public supports(model: unknown): model is RPage {
    return model instanceof RPage || (model as any)?.type === 'page'
  }

  public create(ctx: Parameters<RuntimeStrategy<RPage>['create']>[0]) {
    return PageRuntimeHost.createRuntime({
      id: ctx.id,
      model: ctx.model,
      meta: ctx.meta,
      parent: ctx.parent,
    })
  }
}
