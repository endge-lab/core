import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { ComponentSFCRuntimeHost } from '@/domain/entities/runtime/hosts/ComponentSFCRuntimeHost'
import type { RuntimeStrategy } from '@/domain/services/runtime/RuntimeStrategy'

export class ComponentSFCRuntimeStrategy implements RuntimeStrategy<RComponentSFC> {
  public readonly id = 'runtime:component-sfc'
  public readonly entityType = 'component-sfc'

  public supports(model: unknown): model is RComponentSFC {
    return model instanceof RComponentSFC
      || (model as any)?.type === 'component-sfc'
      || (model as any)?.kind === 'component-sfc'
  }

  public create(ctx: Parameters<RuntimeStrategy<RComponentSFC>['create']>[0]) {
    return ComponentSFCRuntimeHost.createRuntime({
      id: ctx.id,
      model: ctx.model,
      meta: ctx.meta,
      parent: ctx.parent,
      artifactReader: ctx.artifacts,
    })
  }
}
