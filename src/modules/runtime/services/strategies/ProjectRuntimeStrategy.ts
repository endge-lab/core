import type { RuntimeStrategy } from '@/modules/runtime/domain/runtime-strategy.types'
import { RProject } from '@/modules/domain/entities/RProject'
import { ProjectRuntimeHost } from '@/modules/runtime/hosts/ProjectRuntimeHost'

export class ProjectRuntimeStrategy implements RuntimeStrategy<RProject> {
  public readonly id = 'runtime:project'
  public readonly entityType = 'project'

  public supports(model: unknown): model is RProject {
    return model instanceof RProject || (model as any)?.type === 'project'
  }

  public create(ctx: Parameters<RuntimeStrategy<RProject>['create']>[0]) {
    return ProjectRuntimeHost.createRuntime({
      id: ctx.id,
      model: ctx.model,
      meta: ctx.meta,
      parent: ctx.parent,
    })
  }
}
