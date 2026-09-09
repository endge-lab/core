import type { RProject } from '@/features/core/modules/domain/entities/RProject'
import type { RuntimeArtifactReader, RuntimeHost } from '@/features/core/modules/runtime/domain/runtime-host.types'
import type { CompositionProgramPayload } from '@/features/core/modules/source/domain/types/composition-source.types'

import { Raph, RaphNode } from '@endge/raph'
import { CompositionRuntimeHost } from '@/features/core/modules/runtime/hosts/CompositionRuntimeHost'

/** Исполняет собственный корневой граф проекта через общий механизм Composition. */
export class ProjectRuntimeHost extends CompositionRuntimeHost<'project'> {
  public constructor(input: {
    id: string
    model: RProject
    parent?: RuntimeHost<any, any> | null
    meta?: Record<string, unknown>
    artifactReader: RuntimeArtifactReader
  }) {
    super({ ...input, entityType: 'project' })
  }

  /** Создаёт host только из валидного артефакта проекта; старые композиции не участвуют. */
  public static createProjectRuntime(input: {
    id: string
    model: RProject
    meta?: Record<string, any>
    parent?: RuntimeHost<any, any> | null
    artifacts: RuntimeArtifactReader
  }): ProjectRuntimeHost | null {
    const artifact = input.artifacts.getArtifact<CompositionProgramPayload>('project', input.model.id ?? input.model.identity)
    if (!artifact || artifact.status === 'error') {
      return null
    }
    const host = new ProjectRuntimeHost({ ...input, artifactReader: input.artifacts })
    const node = new RaphNode(Raph.app, {
      id: `${input.model.identity}-${input.id}`,
      meta: { type: 'project', runtimeId: input.id, entityIdentity: input.model.identity },
    })
    Raph.app.addNode(node)
    host.addRaphNode(node)
    host.addResource({ id: `node:${node.id}`, kind: 'raph-node', title: node.id })
    host.setInputSource(input.meta?.input)
    return host
  }
}
