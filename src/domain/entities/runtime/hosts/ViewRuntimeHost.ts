import type { RView } from '@/domain/entities/reflect/RView'
import type { RuntimeHost, RuntimeHostContext } from '@/domain/types/runtime/runtime-host.types'

import { Raph, RaphNode } from '@endge/raph'

import { RuntimeHostBase } from '@/domain/entities/runtime/RuntimeHostBase'

function createDefaultViewContext(): RuntimeHostContext<'view'> {
  return {
    status: 'idle',
    startedAt: null,
    updatedAt: null,
    lastRenderAt: null,
  }
}

export class ViewRuntimeHost extends RuntimeHostBase<'view'> {
  constructor(input: {
    id: string
    model: RView
    entityIdentity: string
    parent?: RuntimeHost<any, any> | null
    title?: string
    meta?: Record<string, unknown>
  }) {
    super({
      ...input,
      kind: 'runtime',
      runtimeType: 'view-runtime-host',
      entityType: 'view',
      context: createDefaultViewContext(),
    })
  }

  /**
   * LIFECYCLE
   */
  public static createRuntime(input: {
    id: string
    model: RView
    meta?: Record<string, any>
    parent?: RuntimeHost<any, any> | null
  }): RuntimeHost<'view'> {
    const { id, model } = input
    const meta = input.meta ?? {}
    const parent = input.parent ?? null

    const node = new RaphNode(Raph.app, {
      id: `${model.identity || model.id}-${id}`,
      meta: {
        type: 'view',
        kind: 'root',
        entityId: model.id,
        viewIdentity: model.identity,
        parentRuntimeId: parent?.id ?? null,
        ...meta,
      },
    })

    const host = new ViewRuntimeHost({
      id,
      model,
      entityIdentity: model.identity ?? String(model.id),
      parent,
      title: model.name ?? model.identity ?? `View ${model.id}`,
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
    host.create()
    return host
  }
}
