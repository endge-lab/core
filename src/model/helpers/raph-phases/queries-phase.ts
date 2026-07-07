import type { PhaseName, RaphPhase, RaphNode } from '@endge/raph'

import { Endge } from '@/model/endge/endge'

export class QueriesPhase {
  /**
   * ACCESS
   */
  public static make(): RaphPhase {
    return {
      name: 'queries' as PhaseName,
      routes: ['filters.*'],
      traversal: 'dirty-only',

      nodes: (node: RaphNode) => node.meta?.type === 'query',

      all: (ctxs) => {
        if (!ctxs.length)
          return

        for (const { node } of ctxs) {
          const runtimeId = node.meta?.runtimeId
          const filterId = node.meta?.filterId
          const filterIds = Array.isArray(node.meta?.filterIds)
            ? node.meta.filterIds.map(item => String(item)).filter(Boolean)
            : (filterId ? [String(filterId)] : [])
          const queryIdRaw = node.meta?.entityId

          if (queryIdRaw == null)
            continue

          const queryId
            = typeof queryIdRaw === 'number' || typeof queryIdRaw === 'string'
              ? queryIdRaw
              : String(queryIdRaw ?? '').trim()
          if (!queryId)
            continue

          const query = Endge.domain.getQuery(queryId)
          if (!query)
            continue

          // пространство фильтра из рантайма (meta.space)
          const space = node.meta?.space ?? 'default'
          query.run({ filterSpace: space }).catch((e) => {
            console.error('[queries phase] query.run failed', {
              queryId,
              error: e,
            })
          })

          // уведомляем runtime о смене фильтра
          if (runtimeId && filterIds.length) {
            const host = Endge.runtime.getRuntimeById(String(runtimeId))
            host?.emit('filter:change', { filterId: filterIds[0], filterIds })
          }
        }
      },
    }
  }
}
