import type {
  PathEvent,
  PhaseName,
  RaphNode,
  RaphPhase,
  RaphPhaseTask,
} from '@raphy-js/raph'
import type {
  RuntimeDirtyBoundary,
  RuntimeHost,
  RuntimePhaseEvent,
} from '@/features/core/modules/runtime/domain/runtime-host.types'

import { Endge } from '@/features/core/kernel/endge'
import { RUNTIME_BOUNDARY_UPDATE_PHASE_NAME } from '@/features/core/modules/runtime/domain/runtime-host.types'

export interface RuntimeBoundaryAggregatedUpdate {
  node: RaphNode
  events: RuntimePhaseEvent[]
  boundaries: RuntimeDirtyBoundary[]
}

export interface RuntimeBoundaryUpdatePhaseOptions {
  name?: PhaseName
  resolveHost?: (runtimeId: string) => RuntimeHost | null
}

interface RuntimeBoundaryAccumulator {
  node: RaphNode
  events: RuntimePhaseEvent[]
  dirtyNodes: RaphNode[]
}

/**
 * Агрегирует persistent phase bindings к верхним runtime boundaries.
 */
export class RuntimeBoundaryUpdatePhase {
  public static readonly PHASE_NAME = RUNTIME_BOUNDARY_UPDATE_PHASE_NAME

  public static make(options: RuntimeBoundaryUpdatePhaseOptions = {}): RaphPhase {
    const name = options.name ?? RuntimeBoundaryUpdatePhase.PHASE_NAME

    return {
      name,
      process: (batch) => {
        const updates = aggregateRuntimeBoundaryUpdates(batch.tasks)
        const resolveHost = options.resolveHost
          ?? ((runtimeId: string) => Endge.runtime.getRuntimeById(runtimeId))

        for (const update of updates) {
          const runtimeId = String(update.node.meta?.runtimeId ?? '').trim()
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
            node: update.node,
            events: update.events,
            boundaries: update.boundaries,
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

// Агрегирует consumer-ноды к минимальному списку верхних boundaries.
export function aggregateRuntimeBoundaryUpdates(
  tasks: readonly RaphPhaseTask[],
): RuntimeBoundaryAggregatedUpdate[] {
  const candidates = new Map<string, RuntimeBoundaryAccumulator>()

  for (const task of tasks) {
    const node = task.consumerOwner.node
    if (!node || !isRuntimeNode(node) || task.causes.length === 0) {
      continue
    }

    const boundary = findUpdateBoundary(node)
    if (!boundary) {
      continue
    }

    const accumulator = getBoundaryAccumulator(candidates, boundary)
    for (const cause of task.causes) {
      accumulator.events.push(...(cause.events ?? []).filter(isPathEvent))
    }
    if (!accumulator.dirtyNodes.some(item => item.id === node.id)) {
      accumulator.dirtyNodes.push(node)
    }
  }

  return pruneCoveredUpdates(Array.from(candidates.values())).map(item => ({
    node: item.node,
    events: item.events,
    boundaries: makeBoundaryRecords(item),
  }))
}

function getBoundaryAccumulator(
  boundaries: Map<string, RuntimeBoundaryAccumulator>,
  node: RaphNode,
): RuntimeBoundaryAccumulator {
  const existing = boundaries.get(node.id)
  if (existing) {
    return existing
  }

  const created: RuntimeBoundaryAccumulator = {
    node,
    events: [],
    dirtyNodes: [],
  }
  boundaries.set(node.id, created)
  return created
}

function pruneCoveredUpdates(
  updates: RuntimeBoundaryAccumulator[],
): RuntimeBoundaryAccumulator[] {
  return updates.filter(candidate => !updates.some(other => (
    candidate !== other && isRuntimeAncestor(other.node, candidate.node)
  )))
}

function makeBoundaryRecords(accumulator: RuntimeBoundaryAccumulator): RuntimeDirtyBoundary[] {
  if (accumulator.node.meta?.kind !== 'boundary') {
    return []
  }

  return [{
    boundary: accumulator.node,
    dirtyNodes: accumulator.dirtyNodes,
    events: accumulator.events,
  }]
}

function findUpdateBoundary(node: RaphNode): RaphNode | null {
  for (let current: RaphNode | null = node; current !== null; current = current.parent) {
    if (current.meta?.kind === 'boundary' || current.meta?.kind === 'root') {
      return current
    }
  }
  return null
}

function isRuntimeAncestor(ancestor: RaphNode, node: RaphNode): boolean {
  for (let current: RaphNode | null = node; current !== null; current = current.parent) {
    if (current === ancestor) {
      return true
    }
  }
  return false
}

function isRuntimeNode(node: RaphNode): boolean {
  return node.meta?.type === 'runtime-node'
}

function isPathEvent(event: unknown): event is PathEvent {
  return typeof (event as { path?: unknown })?.path === 'string'
}
