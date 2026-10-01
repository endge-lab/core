import type { PathEvent, PhaseName, RaphNode, RaphPhase, RaphPhaseTask } from '@raphy-js/raph'
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
      process: (batch) => {
        const deliveries = aggregateRootDeliveries(batch.tasks)
        const resolveHost = options.resolveHost
          ?? ((id: string) => Endge.runtime.getRuntimeById(id))

        for (const delivery of deliveries) {
          const runtimeId = String(delivery.node.meta?.runtimeId ?? '').trim()
          if (!runtimeId) {
            continue
          }
          const host = resolveHost(runtimeId)
          const scope = Endge.runtime.getRuntimeScopeByHost(runtimeId)
          if (scope && !scope.acceptsUpdates()) {
            scope.markStale()
            continue
          }
          host?.update({
            node: delivery.node,
            events: delivery.events,
            boundaries: [],
            frame: batch.frame,
          })
        }

        for (const task of batch.tasks) {
          task.run()
        }
      },
    }
  }
}

function aggregateRootDeliveries(tasks: readonly RaphPhaseTask[]) {
  const deliveries = new Map<RaphNode, {
    node: RaphNode
    events: PathEvent[]
  }>()
  for (const task of tasks) {
    const node = task.consumerOwner.node
    if (!node || !isRuntimeRoot(node) || task.causes.length === 0) {
      continue
    }
    const delivery = deliveries.get(node) ?? { node, events: [] }
    for (const cause of task.causes) {
      delivery.events.push(...(cause.events ?? []).filter(isPathEvent))
    }
    deliveries.set(node, delivery)
  }
  return deliveries.values()
}

function isPathEvent(event: unknown): event is PathEvent {
  return typeof (event as { path?: unknown })?.path === 'string'
}

function isRuntimeRoot(node: RaphNode): boolean {
  return node.meta?.type === 'runtime-node' && node.meta?.kind === 'root'
}
