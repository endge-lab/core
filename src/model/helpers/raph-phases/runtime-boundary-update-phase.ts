import type {
  DepGraph,
  PhaseEvent,
  PhaseExecutorContext,
  PhaseName,
  RaphPhase,
} from '@endge/raph'
import type { RuntimeDirtyBoundary, RuntimeHost } from '@/domain/types/runtime-host.types'

import { Raph, RaphNode } from '@endge/raph'

import { RUNTIME_BOUNDARY_UPDATE_PHASE_NAME } from '@/domain/types/runtime-host.types'
import { Endge } from '@/model/endge/endge'

export interface RuntimeBoundaryAggregatedUpdate {
  node: RaphNode
  events: PhaseEvent[]
  boundaries: RuntimeDirtyBoundary[]
}

export interface RuntimeBoundaryUpdatePhaseOptions {
  name?: PhaseName
  getGraph?: () => DepGraph<RaphNode>
  resolveHost?: (runtimeId: string) => RuntimeHost | null
}

interface RuntimeBoundaryAccumulator {
  node: RaphNode
  events: PhaseEvent[]
  dirtyNodes: RaphNode[]
}

/** Универсальная Raph-фаза обновления runtime-сущностей через верхние dirty boundaries. */
export class RuntimeBoundaryUpdatePhase {
  public static readonly PHASE_NAME = RUNTIME_BOUNDARY_UPDATE_PHASE_NAME

  /** Создает Raph-фазу, которая вызывает update у runtime-host верхних dirty boundaries. */
  public static make(options: RuntimeBoundaryUpdatePhaseOptions = {}): RaphPhase {
    const name = options.name ?? RuntimeBoundaryUpdatePhase.PHASE_NAME

    return {
      name,
      routes: ['*'],
      traversal: 'dirty-only',
      nodes: (node: RaphNode) => isRuntimeNode(node),
      all: (ctxs) => {
        if (!ctxs.length)
          return

        const graph = options.getGraph?.() ?? Raph.app.graph
        const updates = aggregateRuntimeBoundaryUpdates(graph, ctxs)
        const resolveHost = options.resolveHost ?? ((runtimeId: string) => Endge.runtime.getRuntimeById(runtimeId))

        for (const update of updates) {
          const runtimeId = String(update.node.meta?.runtimeId ?? '').trim()
          if (!runtimeId)
            continue

          const host = resolveHost(runtimeId)
          host?.update({
            node: update.node,
            events: update.events,
            boundaries: update.boundaries,
            frame: ctxs[0].frame,
          })
        }
      },
    }
  }
}

/** Агрегирует dirty runtime-ноды к минимальному списку верхних dirty boundaries. */
export function aggregateRuntimeBoundaryUpdates(
  graph: DepGraph<RaphNode>,
  ctxs: PhaseExecutorContext[],
): RuntimeBoundaryAggregatedUpdate[] {
  const candidates = new Map<string, RuntimeBoundaryAccumulator>()

  for (const ctx of ctxs) {
    if (!isRuntimeNode(ctx.node))
      continue

    const boundary = findUpdateBoundary(ctx.node, graph)
    if (!boundary)
      continue

    const events = ctx.events ?? []
    const accumulator = getBoundaryAccumulator(candidates, boundary)
    accumulator.events.push(...events)
    if (!accumulator.dirtyNodes.some(node => node.id === ctx.node.id))
      accumulator.dirtyNodes.push(ctx.node)
  }

  return pruneCoveredUpdates(graph, Array.from(candidates.values())).map(item => ({
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
  if (existing)
    return existing

  const created: RuntimeBoundaryAccumulator = {
    node,
    events: [],
    dirtyNodes: [],
  }
  boundaries.set(node.id, created)
  return created
}

function pruneCoveredUpdates(
  graph: DepGraph<RaphNode>,
  updates: RuntimeBoundaryAccumulator[],
): RuntimeBoundaryAccumulator[] {
  return updates.filter((candidate) => {
    return !updates.some(other => {
      if (candidate === other)
        return false

      return isRuntimeAncestor(other.node, candidate.node, graph)
    })
  })
}

function makeBoundaryRecords(accumulator: RuntimeBoundaryAccumulator): RuntimeDirtyBoundary[] {
  if (accumulator.node.meta?.kind !== 'boundary')
    return []

  return [{
    boundary: accumulator.node,
    dirtyNodes: accumulator.dirtyNodes,
    events: accumulator.events,
  }]
}

function findUpdateBoundary(node: RaphNode, graph: DepGraph<RaphNode>): RaphNode | null {
  if (node.meta?.kind === 'root' || node.meta?.kind === 'boundary')
    return node

  return findNearestRuntimeAncestor(node, graph, item => {
    return item.meta?.kind === 'boundary' || item.meta?.kind === 'root'
  })
}

function findNearestRuntimeAncestor(
  node: RaphNode,
  graph: DepGraph<RaphNode>,
  predicate: (node: RaphNode) => boolean,
): RaphNode | null {
  if (predicate(node))
    return node

  const seen = new Set<string>([node.id])
  const queue: RaphNode[] = [node]

  while (queue.length) {
    const current = queue.shift()
    if (!current)
      continue

    for (const parent of graph.parentsOf(current)) {
      if (seen.has(parent.id))
        continue

      if (predicate(parent))
        return parent

      seen.add(parent.id)
      queue.push(parent)
    }
  }

  return null
}

function isRuntimeAncestor(ancestor: RaphNode, node: RaphNode, graph: DepGraph<RaphNode>): boolean {
  if (ancestor.id === node.id)
    return true

  const seen = new Set<string>([node.id])
  const queue: RaphNode[] = [node]

  while (queue.length) {
    const current = queue.shift()
    if (!current)
      continue

    for (const parent of graph.parentsOf(current)) {
      if (seen.has(parent.id))
        continue

      if (parent.id === ancestor.id)
        return true

      seen.add(parent.id)
      queue.push(parent)
    }
  }

  return false
}

function isRuntimeNode(node: RaphNode): boolean {
  return node.meta?.type === 'runtime-node'
}
