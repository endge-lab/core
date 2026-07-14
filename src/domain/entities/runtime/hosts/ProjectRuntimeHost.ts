import type { RProject } from '@/domain/entities/reflect/RProject'
import type { RuntimeHost, RuntimeHostContext } from '@/domain/types/runtime/runtime-host.types'

import { Raph, RaphNode } from '@endge/raph'

import { RuntimeHostBase } from '@/domain/entities/runtime/RuntimeHostBase'

function createDefaultProjectContext(): RuntimeHostContext<'project'> {
  return {
    status: 'idle',
    startedAt: null,
    updatedAt: null,
    lastRefreshAt: null,
  }
}

export class ProjectRuntimeHost extends RuntimeHostBase<'project'> {
  constructor(input: {
    id: string
    model: RProject
    entityIdentity: string
    parent?: RuntimeHost<any, any> | null
    title?: string
    meta?: Record<string, unknown>
  }) {
    super({
      ...input,
      kind: 'runtime',
      runtimeType: 'project-runtime-host',
      entityType: 'project',
      context: createDefaultProjectContext(),
    })
  }

  /**
   * LIFECYCLE
   */
  public static createRuntime(input: {
    id: string
    model: RProject
    meta?: Record<string, any>
    parent?: RuntimeHost<any, any> | null
  }): RuntimeHost<'project'> {
    const { id, model } = input
    const meta = input.meta ?? {}
    const parent = input.parent ?? null

    const node = new RaphNode(Raph.app, {
      id: `${model.identity || model.id}-${id}`,
      meta: {
        type: 'project',
        kind: 'root',
        entityId: model.id,
        projectIdentity: model.identity,
        parentRuntimeId: parent?.id ?? null,
        ...meta,
      },
    })

    const host = new ProjectRuntimeHost({
      id,
      model,
      entityIdentity: model.identity ?? String(model.id),
      parent,
      title: model.displayName ?? model.name ?? model.identity ?? `Project ${model.id}`,
      meta: { ...meta, runtimeKind: 'runtime', parentRuntimeId: parent?.id ?? null },
    })

    Raph.app.addNode(node)
    node.meta.runtimeId = host.id
    node.meta.runtimeKind = 'runtime'
    host.addRaphNode(node)
    host.addResource({
      id: `node:${node.id}`,
      kind: 'raph-node',
      title: node.id,
      subtitle: `${node.meta?.type ?? 'node'}:${node.meta?.kind ?? 'root'}`,
      payload: { meta: node.meta ?? {} },
    })
    host.addChannel({
      id: 'channel:event-bus',
      kind: 'event-bus',
      name: 'Endge.events',
      direction: 'both',
      subtitle: 'Публикация и подписка runtime-событий',
    })
    return host
  }
}
