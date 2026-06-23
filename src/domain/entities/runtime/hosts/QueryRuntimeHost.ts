import type { RQuery } from '@/domain/entities/reflect/RQuery'
import type { RuntimeHost, RuntimeHostContext } from '@/domain/types/runtime-host.types'

import { Raph, RaphNode } from '@endge/raph'
import { RuntimeHostBase } from '@/domain/entities/runtime/RuntimeHostBase'

function createDefaultQueryContext(): RuntimeHostContext<'query'> {
  return {
    status: 'idle',
    startedAt: null,
    updatedAt: null,
    lastFilterChangeAt: null,
  }
}

export class QueryRuntimeHost extends RuntimeHostBase<'query'> {
  constructor(input: {
    id: string
    model: RQuery
    entityIdentity: string
    parent?: RuntimeHost<any, any> | null
    title?: string
    meta?: Record<string, unknown>
  }) {
    super({
      ...input,
      kind: 'query',
      runtimeType: 'query-runtime-host',
      entityType: 'query',
      context: createDefaultQueryContext(),
    })
  }

  /**
   * LIFECYCLE
   */
  public static createRuntime(input: {
    id: string
    model: RQuery
    meta?: Record<string, any>
    parent?: RuntimeHost<any, any> | null
  }): RuntimeHost<'query'> | null {
    const { id, model } = input
    const meta = input.meta ?? {}
    const parent = input.parent ?? null

    const filters = (model as any).filters
    const hasReference = Array.isArray(filters) && filters.some((f: any) => f.mode === 'reference')
    if (!hasReference)
      return null

    const filterId = filters.find((f: any) => f.mode === 'reference')?.filterId ?? null
    const node = new RaphNode(Raph.app, {
      id: `${model.identity}-${id}`,
      meta: {
        type: 'query',
        entityId: model.id,
        filterId,
        parentRuntimeId: parent?.id ?? null,
        ...meta,
      },
    })

    const host = new QueryRuntimeHost({
      id,
      model,
      entityIdentity: model.identity ?? String(model.id),
      parent,
      title: model.name ?? model.identity ?? `Query ${model.id}`,
      meta: {
        runtimeKind: 'query',
        parentRuntimeId: parent?.id ?? null,
      },
    })

    Raph.app.addNode(node)
    node.meta.runtimeId = host.id
    node.meta.runtimeKind = 'query'

    host.addResource({
      id: `node:${node.id}`,
      kind: 'raph-node',
      title: node.id,
      subtitle: `${node.meta?.type ?? 'node'}:${node.meta?.kind ?? 'root'}`,
      payload: {
        meta: node.meta ?? {},
      },
    })
    host.addRaphNode(node)

    host.addChannel({
      id: 'channel:raph',
      kind: 'raph',
      name: 'Raph',
      direction: 'both',
      subtitle: 'Отслеживание изменения данных',
    })
    host.addChannel({
      id: 'channel:event-bus',
      kind: 'event-bus',
      name: 'Endge.events',
      direction: 'out',
      subtitle: 'Публикация runtime-событий',
    })

    const space = meta.space ?? 'default'
    Raph.app.track(node, `filters.${filterId}.${space}.*`)

    host.create()
    return host
  }
}
