import type { PhaseName, RaphPhase, RaphNode } from '@endge/raph'

import { Endge } from '@/model/endge/endge'

export class TablesPhase {
  /**
   * ACCESS
   */
  public static make(): RaphPhase {
    return {
      name: 'tables' as PhaseName,
      routes: ['*'],
      traversal: 'dirty-only',

      // берём только root-ноды таблицы (их track идет на `${basePath}.*`)
      nodes: (node: RaphNode) =>
        node.meta?.type === 'table' && node.meta?.kind === 'root',

      all: (ctxs) => {
        if (!ctxs.length)
          return

        console.groupCollapsed(`[tables phase] root-only ctxs=${ctxs.length}`)
        try {
          for (const { node, events } of ctxs) {
            const runtimeId = node.meta?.runtimeId
            if (!runtimeId)
              continue

            // DEBUG: что именно пришло
            console.log('[tables] dirty root', {
              nodeId: node.id,
              entityId: node.meta?.entityId,
              basePath: node.meta?.basePath,
              runtimeId,
              eventsLen: events?.length ?? 0,
              canonicals: (events ?? []).map((e: any) => e?.canonical),
              originals: (events ?? []).map((e: any) => e?.original),
              resolvedLens: (events ?? []).map(
                (e: any) => e?.resolved?.length ?? 0,
              ),
            })

            const host = Endge.runtime.getRuntimeById(String(runtimeId))
            host?.emit('update:root', {
              events,
              meta: node.meta,
            })
          }
        }
        finally {
          console.groupEnd()
        }
      },
    }
  }
}
