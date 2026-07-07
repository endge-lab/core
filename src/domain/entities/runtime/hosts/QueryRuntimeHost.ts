import type { RQuery } from '@/domain/entities/reflect/RQuery'
import type { QueryProgramFilterItem, QueryProgramPayload } from '@/domain/types/program.types'
import type { RuntimeArtifactReader, RuntimeHost, RuntimeHostContext } from '@/domain/types/runtime-host.types'

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
    artifactReader?: RuntimeArtifactReader | null
  }) {
    super({
      ...input,
      kind: 'query',
      runtimeType: 'query-runtime-host',
      entityType: 'query',
      context: createDefaultQueryContext(),
      artifactReader: input.artifactReader,
      artifactRef: {
        entityType: 'query',
        id: input.model.id,
        identity: input.model.identity,
      },
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
    artifacts: RuntimeArtifactReader
  }): RuntimeHost<'query'> | null {
    const { id, model } = input
    const meta = input.meta ?? {}
    const parent = input.parent ?? null
    const artifactId = model.id ?? model.identity
    const artifact = artifactId != null
      ? input.artifacts.getArtifact<QueryProgramPayload>('query', artifactId)
      : null
    const payload = artifact?.payload ?? null
    if (!payload || artifact?.status === 'error')
      return null

    const referenceFilters = collectReferenceFilters(payload.filters)
    if (!referenceFilters.length)
      return null

    const filterIds = referenceFilters.map(filter => filter.filterId)
    const node = new RaphNode(Raph.app, {
      id: `${model.identity}-${id}`,
      meta: {
        type: 'query',
        entityId: model.id,
        filterId: filterIds[0] ?? null,
        filterIds,
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
      artifactReader: input.artifacts,
      meta: {
        runtimeKind: 'query',
        parentRuntimeId: parent?.id ?? null,
        filterIds,
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
    for (const filterId of filterIds)
      Raph.app.track(node, `filters.${filterId}.${space}.*`)

    host.create()
    return host
  }
}

function collectReferenceFilters(filters: QueryProgramFilterItem[] | undefined): Array<Extract<QueryProgramFilterItem, { mode: 'reference' }>> {
  if (!Array.isArray(filters))
    return []

  return filters.filter((filter): filter is Extract<QueryProgramFilterItem, { mode: 'reference' }> => {
    return filter.mode === 'reference' && String(filter.filterId ?? '').trim().length > 0
  })
}
