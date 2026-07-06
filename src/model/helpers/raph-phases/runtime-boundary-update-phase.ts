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
  root: RaphNode
  events: PhaseEvent[]
  boundaries: RuntimeDirtyBoundary[]
}

export interface RuntimeBoundaryUpdatePhaseOptions {
  name?: PhaseName
  getGraph?: () => DepGraph<RaphNode>
  resolveHost?: (runtimeId: string) => RuntimeHost | null
}

interface RuntimeBoundaryAccumulator {
  root: RaphNode
  events: PhaseEvent[]
  boundaries: Map<string, RuntimeDirtyBoundary>
}

/** Универсальная Raph-фаза обновления runtime-сущностей через root boundary. */
export class RuntimeBoundaryUpdatePhase {
  public static readonly PHASE_NAME = RUNTIME_BOUNDARY_UPDATE_PHASE_NAME

  /** Создает Raph-фазу, которая вызывает update только у root runtime-host. */
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
          const runtimeId = String(update.root.meta?.runtimeId ?? '').trim()
          if (!runtimeId)
            continue

          const host = resolveHost(runtimeId)
          host?.update({
            node: update.root,
            events: update.events,
            boundaries: update.boundaries,
            frame: ctxs[0].frame,
          })
        }
      },
    }
  }
}

/** Агрегирует dirty runtime-ноды к ближайшему root host. */
export function aggregateRuntimeBoundaryUpdates(
  graph: DepGraph<RaphNode>,
  ctxs: PhaseExecutorContext[],
): RuntimeBoundaryAggregatedUpdate[] {
  const roots = new Map<string, RuntimeBoundaryAccumulator>()

  for (const ctx of ctxs) {
    if (!isRuntimeNode(ctx.node))
      continue

    const root = findNearestRuntimeRoot(ctx.node, graph)
    if (!root)
      continue

    const events = ctx.events ?? []
    const accumulator = getRootAccumulator(roots, root)
    accumulator.events.push(...events)

    if (root.id === ctx.node.id)
      continue

    const boundary = findNearestRuntimeBoundary(ctx.node, graph)
    if (!boundary)
      continue

    const boundaryRecord = getBoundaryRecord(accumulator.boundaries, boundary)
    boundaryRecord.events.push(...events)
    if (!boundaryRecord.dirtyNodes.some(node => node.id === ctx.node.id))
      boundaryRecord.dirtyNodes.push(ctx.node)
  }

  return Array.from(roots.values()).map(item => ({
    root: item.root,
    events: item.events,
    boundaries: Array.from(item.boundaries.values()),
  }))
}

function getRootAccumulator(
  roots: Map<string, RuntimeBoundaryAccumulator>,
  root: RaphNode,
): RuntimeBoundaryAccumulator {
  const existing = roots.get(root.id)
  if (existing)
    return existing

  const created: RuntimeBoundaryAccumulator = {
    root,
    events: [],
    boundaries: new Map(),
  }
  roots.set(root.id, created)
  return created
}

function getBoundaryRecord(
  boundaries: Map<string, RuntimeDirtyBoundary>,
  boundary: RaphNode,
): RuntimeDirtyBoundary {
  const existing = boundaries.get(boundary.id)
  if (existing)
    return existing

  const created: RuntimeDirtyBoundary = {
    boundary,
    dirtyNodes: [],
    events: [],
  }
  boundaries.set(boundary.id, created)
  return created
}

function findNearestRuntimeBoundary(node: RaphNode, graph: DepGraph<RaphNode>): RaphNode | null {
  return findNearestRuntimeAncestor(node, graph, item => item.meta?.kind === 'boundary')
}

function findNearestRuntimeRoot(node: RaphNode, graph: DepGraph<RaphNode>): RaphNode | null {
  return findNearestRuntimeAncestor(node, graph, item => item.meta?.kind === 'root')
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

function isRuntimeNode(node: RaphNode): boolean {
  return node.meta?.type === 'runtime-node'
}
