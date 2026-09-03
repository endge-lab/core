import type { RuntimeStrategy } from '@/modules/runtime/domain/runtime-strategy.types'
import { RComposition } from '@/modules/domain/entities/RComposition'
import { CompositionRuntimeHost } from '@/modules/runtime/hosts/CompositionRuntimeHost'

export class CompositionRuntimeStrategy implements RuntimeStrategy<RComposition, CompositionRuntimeHost> {
  public readonly id = 'runtime:composition'
  public readonly entityType = 'composition' as const

  public supports(model: unknown): model is RComposition {
    return model instanceof RComposition
      || (model as any)?.type === 'composition'
  }

  public create(ctx: Parameters<RuntimeStrategy<RComposition, CompositionRuntimeHost>['create']>[0]) {
    return CompositionRuntimeHost.createRuntime({
      id: ctx.id,
      model: ctx.model,
      meta: ctx.meta,
      parent: ctx.parent,
      artifacts: ctx.artifacts,
    })
  }
}
