import type { PhaseName, RaphNode, RaphPhase } from '@endge/raph'
import type { RuntimeHost } from '@/features/core/modules/runtime/domain/runtime-host.types'

import { Endge } from '@/features/core/kernel/endge'
import { RUNTIME_NODE_UPDATE_PHASE_NAME } from '@/features/core/modules/runtime/domain/runtime-host.types'

export interface RuntimeNodeUpdatePhaseOptions {
  name?: PhaseName
  resolveHost?: (runtimeId: string) => RuntimeHost | null
}

/**
 * Выполняет логические runtime update-ы.
 *
 * Фаза ничего не знает о Query, Filter или Composition: она лишь передаёт
 * накопленные Raph events root-ноды соответствующему RuntimeHost.
 */
export class RuntimeNodeUpdatePhase {
  public static readonly PHASE_NAME = RUNTIME_NODE_UPDATE_PHASE_NAME

  public static make(options: RuntimeNodeUpdatePhaseOptions = {}): RaphPhase {
    const name = options.name ?? RuntimeNodeUpdatePhase.PHASE_NAME
    return {
      name,
      routes: ['*'],
      traversal: 'dirty-only',
      nodes: node => isRuntimeRoot(node),
      each: (ctx) => {
        const runtimeId = String(ctx.node.meta?.runtimeId ?? '').trim()
        if (!runtimeId) {
          return
        }
        const resolveHost = options.resolveHost
          ?? ((id: string) => Endge.runtime.getRuntimeById(id))
        const host = resolveHost(runtimeId)
        const scope = Endge.runtime.getRuntimeScopeByHost(runtimeId)
        if (scope && !scope.acceptsUpdates()) {
          scope.markStale()
          return
        }
        host?.update({
          node: ctx.node,
          events: ctx.events ?? [],
          boundaries: [],
          frame: ctx.frame,
        })
      },
    }
  }
}

function isRuntimeRoot(node: RaphNode): boolean {
  return node.meta?.type === 'runtime-node' && node.meta?.kind === 'root'
}
