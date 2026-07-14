import { RComposition } from '@/domain/entities/reflect/RComposition'
import { CompositionRuntimeHost } from '@/domain/entities/runtime/hosts/CompositionRuntimeHost'
import type { RuntimeStrategy } from '@/model/services/runtime/RuntimeStrategy'

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
