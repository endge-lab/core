import type { RComponent } from '@/domain/types/component.types'
import type { RuntimeHost, RuntimeHostContext } from '@/domain/types/runtime-host.types'

import { Raph, RaphNode } from '@endge/raph'

import { RuntimeHostBase } from '@/domain/entities/runtime/RuntimeHostBase'

function createDefaultComponentContext(): RuntimeHostContext<'component'> {
  return {
    status: 'idle',
    startedAt: null,
    updatedAt: null,
    lastRenderAt: null,
  }
}

export class ComponentRuntimeHost extends RuntimeHostBase<'component'> {
  constructor(input: {
    id: string
    model: RComponent
    entityIdentity: string
    parent?: RuntimeHost<any, any> | null
    title?: string
    meta?: Record<string, unknown>
  }) {
    super({
      ...input,
      kind: 'runtime',
      runtimeType: 'component-runtime-host',
      capabilities: ['renderable'],
      entityType: 'component',
      context: createDefaultComponentContext(),
    })
  }

  /**
   * LIFECYCLE
   */
  public static createRuntime(input: {
    id: string
    model: RComponent
    meta?: Record<string, any>
    parent?: RuntimeHost<any, any> | null
  }): RuntimeHost<'component'> | null {
    const { id, model } = input
    const meta = input.meta ?? {}
    const parent = input.parent ?? null
    const basePath = String(meta?.basePath ?? '').trim()
    if (!basePath)
      return null

    const node = new RaphNode(Raph.app, {
      id: `${model.identity || model.id}-${id}`,
      meta: {
        type: 'component',
        kind: 'root',
        entityId: model.id,
        componentIdentity: model.identity,
        parentRuntimeId: parent?.id ?? null,
        basePath,
        ...meta,
      },
    })

    const host = new ComponentRuntimeHost({
      id,
      model,
      entityIdentity: model.identity ?? String(model.id),
      parent,
      title: model.name ?? model.identity ?? `Component ${model.id}`,
      meta: { runtimeKind: 'runtime', parentRuntimeId: parent?.id ?? null, basePath },
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
    host.create()
    return host
  }
}
