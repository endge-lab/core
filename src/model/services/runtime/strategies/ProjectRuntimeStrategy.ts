import { RProject } from '@/domain/entities/reflect/RProject'
import { ProjectRuntimeHost } from '@/domain/entities/runtime/hosts/ProjectRuntimeHost'
import type { RuntimeStrategy } from '@/domain/types/runtime/runtime-strategy.types'

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
