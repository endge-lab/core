import type { RComponent } from '@/domain/types/component.types'
import { ComponentRuntimeHost } from '@/domain/entities/runtime/hosts/ComponentRuntimeHost'
import type { RuntimeStrategy } from '@/model/services/runtime/RuntimeStrategy'

export class ComponentRuntimeStrategy implements RuntimeStrategy<RComponent> {
  public readonly id = 'runtime:component'
  public readonly entityType = 'component'

  public supports(model: unknown): model is RComponent {
    return (model as any)?.type?.startsWith?.('component-') === true
  }

  public create(ctx: Parameters<RuntimeStrategy<RComponent>['create']>[0]) {
    return ComponentRuntimeHost.createRuntime({
      id: ctx.id,
      model: ctx.model,
      meta: ctx.meta,
      parent: ctx.parent,
    })
  }
}
